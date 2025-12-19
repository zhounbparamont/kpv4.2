import React, { useEffect, useState } from "react";
import AV from "../leancloud";
import * as XLSX from "xlsx";

// 汇率表（人民币 -> 站点货币），使用2025-12-19实时汇率
const currencyMap = {
  美国: { code: "USD", symbol: "$", rate: 0.1420, domain: "www.amazon.com" },
  英国: { code: "GBP", symbol: "£", rate: 0.1061, domain: "www.amazon.co.uk" },
  德国: { code: "EUR", symbol: "€", rate: 0.1209, domain: "www.amazon.de" },
  加拿大: { code: "CAD", symbol: "C$", rate: 0.196, domain: "www.amazon.ca" },
  澳洲: { code: "AUD", symbol: "A$", rate: 0.215, domain: "www.amazon.com.au" },
};

// ✅ VAT 默认税率：英国 20%，德国 19%，其他 0%
const VAT_RATE_MAP = {
  英国: 0.2,
  德国: 0.19,
};

const COMMISSION_RATE = 0.15;

const numericFields = [
  "salePrice",
  "purchaseCost",
  "lengthCm",
  "widthCm",
  "heightCm",
  "grossWeightKg",
  "freightUnitPriceRmb",
  "firstCost",
  "lastCost",
  "adCost",
  "storageCost",
  "returnCost",
  "asinPrice",
];

const reservedKeys = ["objectId", "createdAt", "updatedAt", "ACL", "id"];

const defaultForm = {
  sku: "",
  country: "美国",
  category: "party",
  asinValue: "",
  salePrice: "",
  purchaseCost: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  grossWeightKg: "",
  freightUnitPriceRmb: "",
  freightType: "kg", // kg/cbm
  firstCost: "",
  lastCost: "",
  adCost: "",
  storageCost: "",
  returnCost: "",
};

// ✅ 数字清洗兜底：允许用户输入 "1kg" / "10RMB" 也能保存成纯数字
const toNumberSafe = (v, field = "") => {
  if (v === "" || v === null || v === undefined) return null;
  const cleaned = String(v).replace(/[^\d.]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    console.warn(`Invalid numeric value for ${field}: "${v}" -> null`);
    return null;
  }
  return n;
};

// ✅ 预保存验证：检查数值字段
const validateNumericFields = (obj) => {
  const issues = [];
  numericFields.forEach((field) => {
    const val = obj.get(field);
    if (val !== null && val !== undefined && typeof val !== "number") {
      issues.push(field);
    }
  });
  if (issues.length > 0) {
    console.warn("Pre-save validation: Non-numeric values detected:", issues);
  }
  return issues.length === 0;
};

// ✅ 通用保存函数：带 schema 错误检测和字段解析
const safeSave = async (obj, errorContext = "Save operation") => {
  // Pre-validate numerics
  if (!validateNumericFields(obj)) {
    alert(`${errorContext} 警告：检测到非数字值，请检查输入（如 grossWeightKg）。`);
    return false;
  }

  try {
    await obj.save();
    return true;
  } catch (err) {
    console.error(`${errorContext} failed:`, err);
    let fieldHint = "";
    if (err.message.includes("Invalid value type for field")) {
      // Parse field name from error (e.g., extract 'grossWeightKg')
      const fieldMatch = err.message.match(/for field '([^']+)'/);
      const field = fieldMatch ? fieldMatch[1] : "unknown field";
      fieldHint = `（请在 LeanCloud 控制台将 ${field} 类型改为 Number）`;
    }
    alert(`${errorContext} 失败：字段类型不匹配${fieldHint}。详情：${err.message}`);
    return false;
  }
};

// ✅ 利润计算函数（复用在表格和筛选中，按正确 VAT 逻辑，调整 sale 优先级）
const calculateProfit = (item) => {
  const cur = currencyMap[item.country] || { symbol: "$", rate: 1 };
  // ✅ 调整：优先 asinPrice（如果 >0），否则 salePrice
  const sale = Number(item.asinPrice) > 0 ? Number(item.asinPrice) : Number(item.salePrice) || 0;
  if (sale <= 0) return { netSale: 0, commissionFee: 0, totalCost: 0, gp: 0, rate: 0, vatFee: 0 };

  // 实时成本 = purchaseCost * rate（换汇后）
  const realTimeCost = (Number(item.purchaseCost) || 0) * cur.rate;
  const first = Number(item.firstCost) || 0;
  const last = Number(item.lastCost) || 0;

  // VAT：税款金额 = netSale * vatRate（显示用）
  const vatRate = VAT_RATE_MAP[item.country] || 0;
  let netSale;
  if (vatRate > 0) {
    netSale = sale / (1 + vatRate);
  } else {
    netSale = sale;
  }
  const vatFee = sale - netSale;

  // 佣金 = sale * COMMISSION_RATE（基于含 VAT 售价）
  const commissionFee = sale * COMMISSION_RATE;

  // 广告/仓储/退款：基于净售价
  const adFee = ((Number(item.adCost) || 0) / 100) * netSale;
  const storageFee = ((Number(item.storageCost) || 0) / 100) * netSale;
  const returnFee = ((Number(item.returnCost) || 0) / 100) * netSale;

  // 总成本（不含 VAT 和佣金）
  const totalCost = realTimeCost + first + last + adFee + storageFee + returnFee;

  // 毛利 = 净售价 - 佣金 - 总成本
  const gp = netSale - commissionFee - totalCost;

  // 毛利率 = gp / netSale（基于净售价）
  const rate = netSale > 0 ? gp / netSale : 0;

  return { netSale, commissionFee, totalCost, gp, rate, vatFee, sale }; // 返回 sale 用于显示
};

export default function ProductProfilePage() {
  // 数据 & 选择
  const [list, setList] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  // 新增/编辑/复制 拟态框
  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [isCopy, setIsCopy] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [originalSku, setOriginalSku] = useState(null);
  const [form, setForm] = useState(defaultForm);

  // 行内编辑
  const [editingCell, setEditingCell] = useState({ id: null, field: null });
  const [tempValue, setTempValue] = useState("");

  // 筛选 & 分页
  const [filterCountry, setFilterCountry] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [searchSku, setSearchSku] = useState("");
  const [profitFilter, setProfitFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // 抓取进度
  const [showProgress, setShowProgress] = useState(false);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressFail, setProgressFail] = useState(0);
  const [progressAsin, setProgressAsin] = useState("");

  // 模板相关
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateSourceItem, setTemplateSourceItem] = useState(null);

  const [showTemplateList, setShowTemplateList] = useState(false);
  const [templateList, setTemplateList] = useState([]);
  const [templateApplyItem, setTemplateApplyItem] = useState(null);

  // 表单变化
  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "asinValue") {
      setForm((prev) => ({ ...prev, asinValue: (value || "").toUpperCase() }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // 加载数据
  const fetchData = async () => {
    try {
      const q = new AV.Query("ProductProfile");
      q.limit(1000);
      q.ascending("sku");
      const res = await q.find();
      const data = res.map((x) => ({ ...x.toJSON(), id: x.id }));
      setList(data);
      setSelectedRows([]);
      setSelectAll(false);
      setPage(1);
    } catch (err) {
      console.error("加载失败:", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreate = () => {
    setForm(defaultForm);
    setIsEdit(false);
    setIsCopy(false);
    setCurrentId(null);
    setOriginalSku(null);
    setShowModal(true);
  };

  const openEdit = (item) => {
    const asinValue = (item.asinValue || "").toUpperCase();
    setForm({
      ...defaultForm,
      ...item,
      asinValue,
    });
    setIsEdit(true);
    setIsCopy(false);
    setCurrentId(item.id);
    setOriginalSku(null);
    setShowModal(true);
  };

  const openCopy = (item) => {
    const asinValue = (item.asinValue || "").toUpperCase();
    setForm({
      ...defaultForm,
      ...item,
      sku: "", // 清空 SKU，让用户必须输入新 SKU
      asinValue,
    });
    setIsEdit(false);
    setIsCopy(true);
    setCurrentId(null);
    setOriginalSku(item.sku);
    setShowModal(true);
  };

  // 行内保存
  const saveInlineEdit = async (rowId, field, value) => {
    try {
      const obj = AV.Object.createWithoutData("ProductProfile", rowId);

      if (field === "asinValue") {
        value = (value || "").toUpperCase();
      }

      if (value === "" || value == null) {
        obj.set(field, null);
      } else if (numericFields.includes(field)) {
        obj.set(field, toNumberSafe(value, field));
      } else {
        obj.set(field, String(value));
      }

      const success = await safeSave(obj, `Inline edit for ${field}`);
      if (success) {
        await fetchData();
      }
    } catch (err) {
      // Fallback (safeSave already alerts)
    } finally {
      setEditingCell({ id: null, field: null });
    }
  };

  // 可编辑单元格组件
  const EditableCell = ({ item, field, display }) => {
    // SKU 点击触发模板列表，不 inline 编辑
    if (field === "sku") {
      return (
        <td
          className="border px-3 py-1 text-left text-blue-600 cursor-pointer hover:underline"
          onClick={() => openTemplateList(item)}
        >
          {item.sku}
        </td>
      );
    }

    const isEditing =
      editingCell.id === item.id && editingCell.field === field;

    if (isEditing) {
      return (
        <td className="border px-0 py-0 relative text-left">
          <input
            autoFocus
            className="absolute inset-0 w-full h-full border rounded px-2 py-1 box-border focus:ring-2 focus:ring-blue-400"
            value={tempValue}
            onChange={(e) =>
              setTempValue(
                field === "asinValue"
                  ? e.target.value.toUpperCase()
                  : e.target.value
              )
            }
            onBlur={() => saveInlineEdit(item.id, field, tempValue)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveInlineEdit(item.id, field, tempValue);
              if (e.key === "Escape") setEditingCell({ id: null, field: null });
            }}
          />
        </td>
      );
    }

    return (
      <td
        className="border px-3 py-1 text-left cursor-pointer hover:bg-gray-100"
        onClick={() => {
          setEditingCell({ id: item.id, field });
          setTempValue(item[field] ?? "");
        }}
      >
        {display}
      </td>
    );
  };

  const handleDelete = async (id) => {
    if (!window.confirm("确认删除？")) return;
    try {
      await AV.Object.createWithoutData("ProductProfile", id).destroy();
      await fetchData();
    } catch (err) {
      alert("删除失败：" + err.message);
    }
  };

  // 抓取价格，按国家切换站点，返回 true/false
  async function fetchAmazonPrice(asinValue, id, country = "美国") {
    const asin = (asinValue || "").trim().toUpperCase();
    if (!asin) return false;

    const site = currencyMap[country]?.domain || "www.amazon.com";
    const apiKey = "81e31ad2f1bbd6de23e9f724fb71ee85";

    const urlMobile = `https://api.scraperapi.com/?api_key=${apiKey}&url=https://${site}/gp/aw/d/${asin}`;
    const urlPC = `https://api.scraperapi.com/?api_key=${apiKey}&url=https://${site}/dp/${asin}`;

    try {
      let html = await fetch(urlMobile).then((res) => res.text());

      let priceMatch =
        html.match(/\$(\d+\.\d{2})/) ||
        html.match(/"price":"\$(\d+\.\d{2})"/);

      if (!priceMatch) {
        html = await fetch(urlPC).then((res) => res.text());
        priceMatch =
          html.match(/\$(\d+\.\d{2})/) ||
          html.match(/"amount":(\d+\.\d{2})/);
      }

      if (!priceMatch) {
        return false;
      }

      const price = Number(priceMatch[1]);

      const obj = AV.Object.createWithoutData("ProductProfile", id);
      obj.set("asinPrice", price);
      obj.set("asinCurrency", "USD");
      obj.set("asinUpdatedAt", new Date());
      const success = await safeSave(obj, `Fetch price for ASIN ${asin}`);
      return success;
    } catch (err) {
      console.error("抓取价格失败:", err);
      return false;
    }
  }

  // 批量抓取（进度条）
  const batchFetch = async () => {
    if (!selectedRows.length) {
      alert("请先勾选要抓取价格的产品");
      return;
    }

    setShowProgress(true);
    setProgressTotal(selectedRows.length);
    setProgressCurrent(0);
    setProgressFail(0);

    let failCount = 0;

    for (let i = 0; i < selectedRows.length; i++) {
      const row = selectedRows[i];
      if (!row.asinValue) continue;

      setProgressCurrent(i + 1);
      setProgressAsin(row.asinValue);

      // eslint-disable-next-line no-await-in-loop
      const success = await fetchAmazonPrice(
        row.asinValue,
        row.id,
        row.country
      );
      if (!success) failCount++;

      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    setProgressFail(failCount);
    fetchData();

    if (failCount > 0) {
      alert(`抓取完成，但 ${failCount} 个失败，请检查！`);
    }
  };

  const toggleSelectRow = (item) => {
    const exists = selectedRows.some((r) => r.id === item.id);
    if (exists) {
      setSelectedRows(selectedRows.filter((r) => r.id !== item.id));
    } else {
      setSelectedRows([...selectedRows, item]);
    }
  };

  const toggleSelectAll = (displayList) => {
    if (selectAll) {
      setSelectedRows([]);
      setSelectAll(false);
    } else {
      setSelectedRows(displayList);
      setSelectAll(true);
    }
  };

  // Excel 导入
  const handleImportExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const sheetName = workbook.SheetNames[0];
        const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        let success = 0;
        let fail = 0;
        let failRows = [];

        for (let row of sheet) {
          try {
            const obj = new AV.Object("ProductProfile");

            const mapping = {
              SKU: "sku",
              国家: "country",
              类目: "category",
              ASIN: "asinValue",
              售价USD: "salePrice",
              采购RMB: "purchaseCost",
              长cm: "lengthCm",
              宽cm: "widthCm",
              高cm: "heightCm",
              毛重kg: "grossWeightKg",
              运费单价RMB: "freightUnitPriceRmb",
              运费方式: "freightType",
              头程USD: "firstCost",
              尾程USD: "lastCost",
              广告: "adCost",
              仓储: "storageCost",
              退款: "returnCost",
              退货: "returnCost", // 兼容旧模板
            };

            for (let excelKey in mapping) {
              const dbKey = mapping[excelKey];
              if (!dbKey) continue;
              let val = row[excelKey];

              if (dbKey === "asinValue" && val) {
                val = String(val).toUpperCase();
              }

              if (val === undefined || val === "") {
                obj.set(dbKey, null);
              } else if (
                [
                  "salePrice",
                  "purchaseCost",
                  "lengthCm",
                  "widthCm",
                  "heightCm",
                  "grossWeightKg",
                  "freightUnitPriceRmb",
                  "firstCost",
                  "lastCost",
                  "adCost",
                  "storageCost",
                  "returnCost",
                ].includes(dbKey)
              ) {
                // ✅ 导入也做兜底清洗
                obj.set(dbKey, toNumberSafe(val, dbKey));
              } else {
                obj.set(dbKey, String(val));
              }
            }

            const saveSuccess = await safeSave(obj, `Import row for SKU ${row.SKU || "(unknown)"}`);
            if (saveSuccess) {
              success++;
            } else {
              fail++;
              failRows.push(row.SKU || "(未知 SKU)");
            }
          } catch (err) {
            fail++;
            failRows.push(row.SKU || "(未知 SKU)");
          }
        }

        alert(
          `导入完成：成功 ${success} 条，失败 ${fail} 条。\n失败 SKU：${failRows.join(
            ", "
          )}`
        );

        fetchData();
      } catch (err) {
        console.error("Excel 解析失败:", err);
        alert("Excel 解析失败：" + err.message);
      } finally {
        e.target.value = "";
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // 下载模板
  const downloadTemplate = () => {
    const data = [
      {
        SKU: "",
        国家: "美国",
        类目: "party",
        ASIN: "",
        售价USD: "",
        采购RMB: "",
        长cm: "",
        宽cm: "",
        高cm: "",
        毛重kg: "",
        运费单价RMB: "",
        运费方式: "kg",
        头程USD: "",
        尾程USD: "",
        广告: "",
        仓储: "",
        退款: "",
      },
    ];

    const sheet = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Template");
    XLSX.writeFile(wb, "ProductProfile_Import_Template.xlsx");
  };

  // 运费 → 头程自动换算
  useEffect(() => {
    const price = Number(form.freightUnitPriceRmb) || 0;
    const weight = Number(form.grossWeightKg) || 0;
    const len = Number(form.lengthCm) || 0;
    const wid = Number(form.widthCm) || 0;
    const hei = Number(form.heightCm) || 0;
    const cur = currencyMap[form.country] || { rate: 1 };

    if (!price) return;

    let usd = 0;
    if (form.freightType === "kg") {
      if (!weight) return;
      usd = price * weight * cur.rate;
    } else {
      if (!len || !wid || !hei) return;
      const cbm = (len * wid * hei) / 1000000;
      usd = price * cbm * cur.rate;
    }

    const fixed = usd.toFixed(2);
    if (fixed === (form.firstCost || "").toString()) return;

    setForm((prev) => ({
      ...prev,
      firstCost: fixed,
    }));
  }, [
    form.freightUnitPriceRmb,
    form.freightType,
    form.grossWeightKg,
    form.lengthCm,
    form.widthCm,
    form.heightCm,
    form.country,
  ]);

  // 打开模板列表（按 SKU）
  const openTemplateList = async (item) => {
    setTemplateApplyItem(item);

    const q = new AV.Query("ProductTemplate");
    q.equalTo("sku", item.sku);
    q.ascending("createdAt");

    const res = await q.find();
    const data = res.map((x) => ({ id: x.id, ...x.toJSON() }));

    setTemplateList(data);
    setShowTemplateList(true);
  };

  // 保存为模板
  const saveAsTemplate = async () => {
    if (!templateName.trim()) {
      alert("请输入模板名称");
      return;
    }
    if (!templateSourceItem) return;

    try {
      const Template = AV.Object.extend("ProductTemplate");
      const obj = new Template();

      obj.set("templateName", templateName.trim());
      obj.set("sku", templateSourceItem.sku);
      obj.set("country", templateSourceItem.country);
      obj.set("category", templateSourceItem.category);
      obj.set("asinValue", templateSourceItem.asinValue);
      obj.set("salePrice", templateSourceItem.salePrice);
      obj.set("purchaseCost", templateSourceItem.purchaseCost);
      obj.set("lengthCm", templateSourceItem.lengthCm);
      obj.set("widthCm", templateSourceItem.widthCm);
      obj.set("heightCm", templateSourceItem.heightCm);
      obj.set("grossWeightKg", templateSourceItem.grossWeightKg);
      obj.set("freightUnitPriceRmb", templateSourceItem.freightUnitPriceRmb);
      obj.set("freightType", templateSourceItem.freightType);
      obj.set("firstCost", templateSourceItem.firstCost);
      obj.set("lastCost", templateSourceItem.lastCost);
      obj.set("adCost", templateSourceItem.adCost);
      obj.set("storageCost", templateSourceItem.storageCost);
      obj.set("returnCost", templateSourceItem.returnCost);

      await obj.save();
      alert("模板保存成功！");
      setShowTemplateSave(false);
    } catch (err) {
      alert("保存模板失败：" + err.message);
    }
  };

  // 应用模板：覆盖当前 SKU 行
  const applyTemplate = async (tpl) => {
    if (!templateApplyItem) return;
    try {
      const obj = AV.Object.createWithoutData(
        "ProductProfile",
        templateApplyItem.id
      );

      const fields = [
        "country",
        "category",
        "asinValue",
        "salePrice",
        "purchaseCost",
        "lengthCm",
        "widthCm",
        "heightCm",
        "grossWeightKg",
        "freightUnitPriceRmb",
        "freightType",
        "firstCost",
        "lastCost",
        "adCost",
        "storageCost",
        "returnCost",
      ];

      fields.forEach((key) => {
        let val = tpl[key];
        if (numericFields.includes(key)) {
          val = toNumberSafe(val, key); // Ensure numeric
        } else if (key === "asinValue") {
          val = (val || "").toUpperCase();
        }
        obj.set(key, val ?? null);
      });

      const success = await safeSave(obj, `Apply template to SKU ${templateApplyItem.sku}`);
      if (success) {
        alert("已应用模板！");
        setShowTemplateList(false);
        fetchData();
      }
    } catch (err) {
      // Fallback (safeSave already handles)
    }
  };

  // 删除模板（新增）
  const deleteTemplate = async (tplId) => {
    if (!window.confirm("确认删除该模板？")) return;

    try {
      const obj = AV.Object.createWithoutData("ProductTemplate", tplId);
      await obj.destroy();

      // 删除后刷新当前 SKU 的模板列表
      if (templateApplyItem) {
        const q = new AV.Query("ProductTemplate");
        q.equalTo("sku", templateApplyItem.sku);
        q.ascending("createdAt");

        const res = await q.find();
        const data = res.map((x) => ({ id: x.id, ...x.toJSON() }));
        setTemplateList(data);
      }
    } catch (err) {
      alert("删除失败：" + err.message);
    }
  };

  // 过滤 + 毛利率筛选 + 分页（使用 calculateProfit 的新 rate）
  const filteredList = list
    .filter((item) => (filterCountry ? item.country === filterCountry : true))
    .filter((item) => (filterCategory ? item.category === filterCategory : true))
    .filter((item) =>
      searchSku
        ? (item.sku || "").toLowerCase().includes(searchSku.toLowerCase())
        : true
    )
    .filter((item) => {
      if (!profitFilter) return true;

      const { rate } = calculateProfit(item); // 使用新计算

      if (profitFilter === "high") return rate > 0.3;
      if (profitFilter === "mid") return rate > 0.15;
      if (profitFilter === "low") return rate >= 0 && rate <= 0.15;
      if (profitFilter === "negative") return rate < 0;

      return true;
    });

  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const displayList = filteredList.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="p-6">
      <style>{`
        table tr td, table tr th {
          padding-top: 4px !important;
          padding-bottom: 4px !important;
        }
      `}</style>

      <h1 className="text-2xl font-bold mb-4 text-blue-700">
        📘 产品档案 / 利润模型
      </h1>

      {/* 按钮 + 筛选区 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          ➕ 新增产品档案
        </button>

        <button
          onClick={batchFetch}
          className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
        >
          📦 批量抓取价格
        </button>

        {/* 导入 Excel */}
        <button
          onClick={() => document.getElementById("excelInput").click()}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
        >
          📥 导入 Excel
        </button>
        <input
          type="file"
          id="excelInput"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={handleImportExcel}
        />

        {/* 模板下载 */}
        <button
          onClick={downloadTemplate}
          className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
        >
          📄 下载导入模板
        </button>

        {/* 国家筛选 */}
        <select
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
          className="border px-3 py-2 rounded"
        >
          <option value="">全部国家</option>
          {Object.keys(currencyMap).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {/* 类目筛选（craft 已存在） */}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="border px-3 py-2 rounded"
        >
          <option value="">全部类目</option>
          <option value="party">party</option>
          <option value="sport">sport</option>
          <option value="craft">craft</option>
        </select>

        {/* SKU 搜索 */}
        <input
          type="text"
          value={searchSku}
          onChange={(e) => setSearchSku(e.target.value)}
          placeholder="按 SKU 搜索"
          className="border px-3 py-2 rounded w-48"
        />

        {/* 毛利率筛选（基于新计算） */}
        <select
          value={profitFilter}
          onChange={(e) => setProfitFilter(e.target.value)}
          className="border px-3 py-2 rounded"
        >
          <option value="">全部毛利率</option>
          <option value="high">高毛利率（>30%）</option>
          <option value="mid">中等毛利率（>15%）</option>
          <option value="low">低毛利率（0–15%）</option>
          <option value="negative">负毛利率</option>
        </select>
      </div>

      {/* 表格（✅ 去除“计算售价”列，调整列顺序） */}
      <div className="overflow-auto bg-white rounded-lg shadow">
        <table className="min-w-full text-sm table-auto">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="border px-4 py-1">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={() => toggleSelectAll(displayList)}
                />
              </th>
              <th className="border px-4 py-1 text-left">SKU</th>
              <th className="border px-4 py-1 text-left">国家</th>
              <th className="border px-4 py-1 text-left">类目</th>
              <th className="border px-4 py-1 text-left">ASIN</th>
              <th className="border px-4 py-1 text-left">实时</th>
              {/* ✅ 新增：净售价列（紧跟实时后） */}
              <th className="border px-4 py-1 text-left">净售价</th>
              <th className="border px-4 py-1 text-left">采购RMB</th>
              <th className="border px-4 py-1 text-left">换汇</th>
              <th className="border px-4 py-1 text-left">头程</th>
              <th className="border px-4 py-1 text-left">尾程</th>
              <th className="border px-4 py-1 text-left">广告%</th>
              <th className="border px-4 py-1 text-left">仓储%</th>
              <th className="border px-4 py-1 text-left">退款%</th>
              {/* ✅ VAT 列：显示税款，不计入成本 */}
              <th className="border px-4 py-1 text-left">增值税</th>
              <th className="border px-4 py-1 text-left">佣金</th>
              <th className="border px-4 py-1 text-left">毛利</th>
              <th className="border px-4 py-1 text-left">毛利率</th>
              <th className="border px-4 py-1 text-left">操作</th>
            </tr>
          </thead>

          <tbody>
            {displayList.map((item) => {
              const cur = currencyMap[item.country] || {
                symbol: "$",
                rate: 1,
              };

              // ✅ 使用新计算函数
              const { netSale, commissionFee, gp, rate, vatFee, sale } = calculateProfit(item);

              const rateDisplay = netSale > 0 ? (rate * 100).toFixed(1) + "%" : "-";

              const isSelected = selectedRows.some((r) => r.id === item.id);

              const rowClass =
                rate > 0.3
                  ? "bg-blue-50"
                  : rate < 0
                  ? "bg-red-50"
                  : "";

              return (
                <tr key={item.id} className={`hover:bg-gray-50 ${rowClass}`}>
                  <td className="border px-4 py-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectRow(item)}
                    />
                  </td>

                  {/* SKU：点击打开模板列表 */}
                  <EditableCell item={item} field="sku" display={item.sku} />

                  <EditableCell
                    item={item}
                    field="country"
                    display={item.country}
                  />

                  <EditableCell
                    item={item}
                    field="category"
                    display={item.category}
                  />

                  <EditableCell
                    item={item}
                    field="asinValue"
                    display={item.asinValue}
                  />

                  {/* 实时价格可编辑（asinPrice，直接用于计算） */}
                  <EditableCell
                    item={item}
                    field="asinPrice"
                    display={item.asinPrice ? `${cur.symbol}${item.asinPrice}` : "-"}
                  />

                  {/* ✅ 新增：净售价显示 */}
                  <td className="border px-3 py-1">
                    {netSale > 0 ? `${cur.symbol}${netSale.toFixed(2)}` : "-"}
                  </td>

                  <EditableCell
                    item={item}
                    field="purchaseCost"
                    display={item.purchaseCost ? `¥${item.purchaseCost}` : "-"}
                  />

                  {/* 实时成本列 */}
                  <td className="border px-3 py-1">
                    {item.purchaseCost ? `${cur.symbol}${(Number(item.purchaseCost) * cur.rate).toFixed(2)}` : "-"}
                  </td>

                  <EditableCell
                    item={item}
                    field="firstCost"
                    display={item.firstCost ? `${cur.symbol}${item.firstCost}` : `- ${cur.symbol}`}
                  />

                  <EditableCell
                    item={item}
                    field="lastCost"
                    display={item.lastCost ? `${cur.symbol}${item.lastCost}` : `- ${cur.symbol}`}
                  />

                  <EditableCell
                    item={item}
                    field="adCost"
                    display={item.adCost ? `${item.adCost}%` : "-"}
                  />

                  <EditableCell
                    item={item}
                    field="storageCost"
                    display={item.storageCost ? `${item.storageCost}%` : "-"}
                  />

                  <EditableCell
                    item={item}
                    field="returnCost"
                    display={item.returnCost ? `${item.returnCost}%` : "-"}
                  />

                  {/* ✅ VAT 显示：税款金额 */}
                  <td className="border px-3 py-1 text-red-700">
                    {vatFee > 0 ? `${cur.symbol}${vatFee.toFixed(2)}` : "-"}
                  </td>

                  <td className="border px-3 py-1 text-orange-700">
                    {commissionFee.toFixed(2)} {cur.symbol}
                  </td>

                  <td className="border px-3 py-1 text-green-700">
                    {cur.symbol}{gp.toFixed(2)}
                  </td>

                  <td className="border px-3 py-1 text-green-700">
                    {rateDisplay}
                  </td>

                  <td className="border px-2 py-0 space-x-1 whitespace-nowrap">
                    <button
                      onClick={() => openEdit(item)}
                      className="text-blue-600 hover:underline text-xs px-1"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        setShowProgress(true);
                        setProgressTotal(1);
                        setProgressCurrent(0);
                        setProgressFail(0);
                        setProgressAsin(item.asinValue || "");

                        fetchAmazonPrice(
                          item.asinValue,
                          item.id,
                          item.country
                        ).then((success) => {
                          setProgressCurrent(1);
                          if (!success) setProgressFail(1);
                          fetchData();
                        });
                      }}
                      className="text-purple-600 hover:underline text-xs px-1"
                    >
                      抓取
                    </button>
                    <button
                      onClick={() => {
                        setTemplateSourceItem(item);
                        setTemplateName("");
                        setShowTemplateSave(true);
                      }}
                      className="text-green-600 hover:underline text-xs px-1"
                    >
                      模板
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-red-600 hover:underline text-xs px-1"
                    >
                      删除
                    </button>
                    <button
                      onClick={() => openCopy(item)}
                      className="text-indigo-600 hover:underline text-xs px-1"
                    >
                      复制
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex justify-center items-center gap-3 mt-4 text-sm">
        <button
          disabled={currentPage === 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          上一页
        </button>
        <span>
          第 {currentPage} / {totalPages} 页（共 {filteredList.length} 条）
        </span>
        <button
          disabled={currentPage === totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          下一页
        </button>
      </div>

      {/* 新增 / 编辑 / 复制 拟态框（保留 salePrice 输入作为备选） */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl shadow-xl">
            <h2 className="text-xl font-bold mb-5">
              {isEdit ? "编辑产品档案" : isCopy ? "复制产品档案" : "新增产品档案"}
            </h2>

            <div className="grid grid-cols-2 gap-6 text-sm">
              <div>
                <label>SKU {isCopy && <span className="text-red-500">*</span>}</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  disabled={isEdit} // 编辑时锁死，复制时允许修改
                  placeholder={isCopy ? "必须修改 SKU" : ""}
                />
                {isCopy && <p className="text-xs text-red-500 mt-1">复制时必须修改 SKU 为唯一值</p>}
              </div>

              <div>
                <label>国家</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  name="country"
                  value={form.country}
                  onChange={handleChange}
                >
                  {Object.keys(currencyMap).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>类目</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                >
                  <option value="party">party</option>
                  <option value="sport">sport</option>
                  <option value="craft">craft</option>
                </select>
              </div>

              <div>
                <label>ASIN</label>
                <input
                  className="w-full border rounded px-3 py-2 uppercase"
                  name="asinValue"
                  value={form.asinValue}
                  onChange={handleChange}
                  placeholder="如 B0XXXXX"
                />
              </div>

              {/* 尺寸 + 毛重 */}
              <div className="col-span-2">
                <label>产品尺寸 (cm) + 毛重(kg)</label>
                <div className="flex items-center gap-4 mt-1">
                  <div className="flex items-center gap-2">
                    <input
                      name="lengthCm"
                      value={form.lengthCm}
                      onChange={handleChange}
                      placeholder="长"
                      className="w-20 border rounded px-3 py-2"
                    />
                    ×
                    <input
                      name="widthCm"
                      value={form.widthCm}
                      onChange={handleChange}
                      placeholder="宽"
                      className="w-20 border rounded px-3 py-2"
                    />
                    ×
                    <input
                      name="heightCm"
                      value={form.heightCm}
                      onChange={handleChange}
                      placeholder="高"
                      className="w-20 border rounded px-3 py-2"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span>毛重(kg)</span>
                    {/* ✅ BUG 修复：只能输入数字 */}
                    <input
                      type="number"
                      step="0.001"
                      name="grossWeightKg"
                      value={form.grossWeightKg}
                      onChange={handleChange}
                      placeholder="请输入数字"
                      className="w-24 border rounded px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              {/* 运费配置 */}
              <div className="col-span-2">
                <label>运费 (¥)</label>
                <div className="flex items-center gap-4 mt-1">
                  {/* ✅ BUG 修复：只能输入数字 */}
                  <input
                    type="number"
                    step="0.01"
                    name="freightUnitPriceRmb"
                    value={form.freightUnitPriceRmb}
                    onChange={handleChange}
                    placeholder="运费单价（纯数字）"
                    className="w-40 border rounded px-3 py-2"
                  />
                  <span>/</span>
                  <select
                    name="freightType"
                    value={form.freightType}
                    onChange={handleChange}
                    className="border rounded px-3 py-2"
                  >
                    <option value="kg">每公斤</option>
                    <option value="cbm">每立方米</option>
                  </select>
                  <span className="text-gray-500 text-xs">
                    自动换算为 {currencyMap[form.country]?.symbol || '$'} 填入下方“头程”
                  </span>
                </div>
              </div>

              <div>
                <label>售价（{currencyMap[form.country]?.symbol || '$'}，备选）</label>
                <input
                  name="salePrice"
                  value={form.salePrice}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                  placeholder="若无实时价格，使用此值"
                />
              </div>

              <div>
                <label>采购成本（¥）</label>
                <input
                  name="purchaseCost"
                  value={form.purchaseCost}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label>头程（{currencyMap[form.country]?.symbol || '$'}）</label>
                <input
                  name="firstCost"
                  value={form.firstCost}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label>尾程（{currencyMap[form.country]?.symbol || '$'}）</label>
                <input
                  name="lastCost"
                  value={form.lastCost}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label>广告预估（%）</label>
                <input
                  name="adCost"
                  value={form.adCost}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label>仓储预估（%）</label>
                <input
                  name="storageCost"
                  value={form.storageCost}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label>退款预估（%）</label>
                <input
                  name="returnCost"
                  value={form.returnCost}
                  onChange={handleChange}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowModal(false);
                  setIsCopy(false);
                  setOriginalSku(null);
                }}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              >
                取消
              </button>

              <button
                onClick={async () => {
                  try {
                    // 复制时额外检查 SKU 已修改
                    if (isCopy && form.sku === originalSku) {
                      alert("复制时必须修改 SKU 为唯一值！");
                      return;
                    }

                    // 同国家 SKU 不允许重复
                    const q = new AV.Query("ProductProfile");
                    q.equalTo("sku", form.sku);
                    q.equalTo("country", form.country);
                    const existed = await q.find();
                    const conflict = existed.filter((x) => x.id !== currentId);
                    if (conflict.length > 0) {
                      alert("同一个国家下已存在相同 SKU，禁止重复！");
                      return;
                    }

                    const Model = AV.Object.extend("ProductProfile");
                    const obj = isEdit
                      ? AV.Object.createWithoutData("ProductProfile", currentId)
                      : new Model();

                    Object.keys(form).forEach((key) => {
                      if (reservedKeys.includes(key)) return;

                      // 不允许手动覆盖 asinUpdatedAt（Date 类型）
                      if (key === "asinUpdatedAt") return;

                      let value = form[key];

                      if (key === "asinValue") {
                        value = (value || "").toUpperCase();
                      }

                      if (value === "" || value === null || value === undefined) {
                        obj.set(key, null);
                      } else if (numericFields.includes(key)) {
                        // ✅ 兜底：即便有人粘贴了 "1kg"/"10RMB" 也能保存
                        obj.set(key, toNumberSafe(value, key));
                      } else {
                        obj.set(key, String(value));
                      }
                    });

                    const saveSuccess = await safeSave(obj, isEdit ? "Update product" : "Create product");
                    if (saveSuccess) {
                      setShowModal(false);
                      setIsCopy(false);
                      setOriginalSku(null);
                      await fetchData();
                    }
                  } catch (err) {
                    // Fallback (safeSave already handles)
                  }
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 保存为模板 拟态框 */}
      {showTemplateSave && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 w-96 rounded-lg shadow-xl">
            <h2 className="text-lg font-bold mb-4">保存为模板</h2>

            <label>模板名称</label>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full border rounded px-3 py-2 mt-2"
              placeholder="如：美国-小号版本模板"
            />

            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowTemplateSave(false)}
                className="px-4 py-2 bg-gray-300 rounded"
              >
                取消
              </button>
              <button
                onClick={saveAsTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 模板列表 拟态框（已加删除按钮） */}
      {showTemplateList && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 w-96 rounded-lg shadow-xl">
            <h2 className="text-lg font-bold mb-4">
              模板列表（SKU：{templateApplyItem?.sku}）
            </h2>

            {templateList.length === 0 && (
              <p className="text-gray-600">暂无模板</p>
            )}

            <ul className="space-y-2 max-h-72 overflow-auto">
              {templateList.map((tpl) => (
                <li
                  key={tpl.id}
                  className="p-2 border rounded flex justify-between items-center hover:bg-gray-100"
                >
                  {/* 点击名称 → 应用模板 */}
                  <span
                    className="cursor-pointer hover:text-blue-600"
                    onClick={() => applyTemplate(tpl)}
                  >
                    {tpl.templateName || "(未命名模板)"}
                  </span>

                  {/* 删除按钮 "-" */}
                  <button
                    className="text-red-600 font-bold px-2 hover:text-red-800"
                    onClick={() => deleteTemplate(tpl.id)}
                  >
                    −
                  </button>
                </li>
              ))}
            </ul>

            <button
              onClick={() => setShowTemplateList(false)}
              className="mt-4 w-full bg-gray-600 text-white py-2 rounded"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 抓取价格进度条 拟态框 */}
      {showProgress && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl">
            <h2 className="text-lg font-bold mb-4">价格抓取中…</h2>

            <p className="mb-1 break-all">当前 ASIN：{progressAsin || "-"}</p>
            <p className="mb-1">
              进度：{progressCurrent} / {progressTotal}
            </p>
            <p className="mb-3 text-red-600">失败：{progressFail}</p>

            <div className="w-full bg-gray-200 h-3 rounded mb-4">
              <div
                className="h-3 bg-blue-500 rounded"
                style={{
                  width:
                    progressTotal > 0
                      ? `${(progressCurrent / progressTotal) * 100}%`
                      : "0%",
                }}
              ></div>
            </div>

            <button
              className="w-full bg-gray-600 text-white py-2 rounded hover:bg-gray-700"
              onClick={() => setShowProgress(false)}
            >
              关闭窗口（后台继续）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
