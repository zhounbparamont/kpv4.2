import { useEffect, useState } from "react";
import AV from "../leancloud";
import * as XLSX from 'xlsx';
import CryptoJS from 'crypto-js';

// 汇率表（人民币 -> 站点货币）
const currencyMap = {
  美国: { code: "USD", rate: 0.14, domain: "www.amazon.com" },
  英国: { code: "GBP", rate: 0.11, domain: "www.amazon.co.uk" },
  德国: { code: "EUR", rate: 0.13, domain: "www.amazon.de" },
  加拿大: { code: "CAD", rate: 0.19, domain: "www.amazon.ca" },
  澳洲: { code: "AUD", rate: 0.21, domain: "www.amazon.com.au" },
};

const COMMISSION_RATE = 0.15;

// Feishu bot webhook URL and secret key
const FEISHU_WEBHOOK_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/72b3ff0f-9430-454d-bd81-d603136806b9';
const FEISHU_SECRET_KEY = ''; // Replace with your Feishu bot's Secret Key if signature verification is enabled

export default function OperateDispatchPage() {
  const [list, setList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [form, setForm] = useState({ sku: "", quantity: "", country: "美国", remark: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Filter states
  const [filterCountry, setFilterCountry] = useState("全部");
  const [filterSubmittedBy, setFilterSubmittedBy] = useState("全部");
  const [filterMonth, setFilterMonth] = useState("全部");
  const [filterStatus, setFilterStatus] = useState("全部");
  const [searchSku, setSearchSku] = useState("");
  const [submittedByOptions, setSubmittedByOptions] = useState(["全部"]);
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;
  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editedQuantity, setEditedQuantity] = useState("");
  const [editedRemark, setEditedRemark] = useState("");
  // Profile and Template states
  const [profileMap, setProfileMap] = useState({});
  const [skuOptions, setSkuOptions] = useState([]);
  const [templateOptions, setTemplateOptions] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [profitInfo, setProfitInfo] = useState({ gp: '-', rate: '-' });
  // Modal state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const q = new AV.Query("PurchaseRequest");
      q.descending("createdAt");
      q.limit(1000);
      const results = await q.find();
      const data = results.map(item => ({ id: item.id, ...item.toJSON() }));
      console.log('Fetched PurchaseRequest records:', { count: data.length, data });
      setList(data);
      const uniqueSubmittedBy = [
        "全部",
        ...new Set(data.map(item => item.submittedBy).filter(Boolean)),
      ];
      setSubmittedByOptions(uniqueSubmittedBy);
      if (data.length === 0) {
        setError('没有找到派单记录，请检查 LeanCloud 数据表');
      }
    } catch (error) {
      console.error("获取派单记录失败:", error);
      setError(`获取派单记录失败：${error.message}`);
      setList([]);
    } finally {
      setLoading(false);
    }

    try {
      await loadProfiles();
    } catch (err) {
      console.error("加载产品档案失败:", err);
    }
  };

  const loadProfiles = async () => {
    try {
      const profileQuery = new AV.Query("ProductProfile");
      profileQuery.limit(1000);
      const res = await profileQuery.find();
      const map = {};
      res.forEach(p => {
        const json = p.toJSON();
        const key = `${json.country}-${json.sku}`;
        map[key] = { id: p.id, ...json };
      });
      setProfileMap(map);
    } catch (err) {
      console.error("加载产品档案失败:", err);
    }
  };

  useEffect(() => {
    if (form.country && form.country !== "其他") {
      const profilesForCountry = Object.values(profileMap).filter(p => p.country === form.country);
      const skus = [...new Set(profilesForCountry.map(p => p.sku))].sort();
      setSkuOptions(skus);
      setForm(prev => ({ ...prev, sku: "" })); // Reset SKU
      setSelectedTemplateId("");
      setProfitInfo({ gp: '-', rate: '-' });
      setTemplateOptions([]);
    } else if (form.country === "其他") {
      const allSkus = [...new Set(Object.values(profileMap).map(p => p.sku))].sort();
      setSkuOptions(allSkus);
      setForm(prev => ({ ...prev, sku: "" }));
      setSelectedTemplateId("");
      setProfitInfo({ gp: '-', rate: '-' });
      setTemplateOptions([]);
    } else {
      setSkuOptions([]);
    }
  }, [form.country, profileMap]);

  useEffect(() => {
    if (form.sku) {
      loadTemplates(form.sku);
    } else {
      setTemplateOptions([]);
      setSelectedTemplateId("");
      setProfitInfo({ gp: '-', rate: '-' });
    }
  }, [form.sku]);

  const loadTemplates = async (sku) => {
    try {
      const q = new AV.Query("ProductTemplate");
      q.equalTo("sku", sku);
      q.ascending("createdAt");
      const res = await q.find();
      const data = res.map(x => ({ id: x.id, ...x.toJSON() }));
      setTemplateOptions(data);
      setSelectedTemplateId("");
      setProfitInfo({ gp: '-', rate: '-' });
    } catch (err) {
      console.error("加载模板失败:", err);
      setTemplateOptions([]);
    }
  };

  // ✅ 修复：模板不包含 asinPrice，这里只使用 salePrice 计算利润
  const calculateProfit = (tpl) => {
    const cur = currencyMap[tpl.country] || { code: "USD", rate: 1 };

    const sale = Number(tpl.salePrice) || 0;
    if (sale <= 0) {
      setProfitInfo({ gp: '-', rate: '-' });
      return;
    }

    const purchaseSite = (Number(tpl.purchaseCost) || 0) * cur.rate;
    const first = Number(tpl.firstCost) || 0;
    const last = Number(tpl.lastCost) || 0;
    const adFee = ((Number(tpl.adCost) || 0) / 100) * sale;
    const storageFee = ((Number(tpl.storageCost) || 0) / 100) * sale;
    const returnFee = ((Number(tpl.returnCost) || 0) / 100) * sale;
    const commissionFee = sale * COMMISSION_RATE;
    const total = purchaseSite + first + last + adFee + storageFee + returnFee + commissionFee;
    const gp = sale - total;
    const rate = sale > 0 ? gp / sale : 0;
    setProfitInfo({
      gp: gp.toFixed(2),
      rate: (rate * 100).toFixed(1)
    });
  };

  const sendFeishuMessage = async (sku, quantity, country) => {
    try {
      const safeSku = String(sku || '').replace(/["\\]/g, '');
      const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : 0;
      const safeCountry = String(country || '').replace(/["\\]/g, '');
      const timestamp = Math.floor(Date.now() / 1000);
      let sign = '';
      if (FEISHU_SECRET_KEY) {
        const stringToSign = `${timestamp}\n${FEISHU_SECRET_KEY}`;
        sign = CryptoJS.HmacSHA256(stringToSign, FEISHU_SECRET_KEY).toString(CryptoJS.enc.Base64);
      }
      const message = {
        msg_type: 'text',
        content: {
          text: `新派单通知:\nSKU: ${safeSku}\n数量: ${safeQuantity}\n国别: ${safeCountry}`
        },
        ...(FEISHU_SECRET_KEY && { timestamp: timestamp.toString(), sign })
      };
      console.log('Sending Feishu message payload:', JSON.stringify(message, null, 2));
      const response = await fetch(FEISHU_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });
      const responseBody = await response.json();
      console.log('Feishu API response:', responseBody);
      if (!response.ok || responseBody.code !== 0) {
        throw new Error(`飞书 API 错误: ${response.status} ${responseBody.msg || responseBody.message || '未知错误'} (Code: ${responseBody.code})`);
      }
      console.log('飞书消息发送成功');
      return true;
    } catch (err) {
      console.error('发送飞书消息失败:', err);
      alert('飞书消息发送失败: ' + (err.message || '未知错误'));
      return false;
    }
  };

  const handleSubmitRequest = async () => {
    if (!form.sku || !form.quantity) {
      alert("SKU 和数量不能为空");
      return;
    }
    try {
      const Request = AV.Object.extend("PurchaseRequest");
      const req = new Request();
      req.set("sku", form.sku.trim());
      req.set("quantity", parseInt(form.quantity));
      req.set("country", form.country);
      req.set("remark", form.remark);
      req.set("status", "待提交");
      const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
      req.set("submittedBy", currentUser.username || "未知");
      req.set("submittedAt", new Date());
      await req.save();
      console.log('Saved new PurchaseRequest:', { sku: form.sku, quantity: form.quantity, country: form.country });
      alert("派单保存成功");
      setForm({ sku: "", quantity: "", country: "美国", remark: "" });
      setSelectedTemplateId("");
      setProfitInfo({ gp: '-', rate: '-' });
    } catch (err) {
      console.error("提交失败：", err);
      alert("提交失败: " + (err.message || "未知错误"));
    }
  };

  const submitRequest = async (item) => {
    if (!window.confirm(`确认提交 SKU: ${item.sku} 的派单记录吗？提交后将无法修改`)) return;
    try {
      const obj = AV.Object.createWithoutData("PurchaseRequest", item.id);
      obj.set("status", "已提交");
      await obj.save();
      console.log('Submitted PurchaseRequest:', { id: item.id, sku: item.sku });
      await sendFeishuMessage(item.sku, item.quantity, item.country);
      window.open('https://www.feishu.cn/messenger/', '_blank');
      alert("提交成功");
      fetchData();
    } catch (err) {
      console.error("提交失败：", err);
      alert("提交失败: " + (err.message || "未知错误"));
    }
  };

  const deleteRequest = async (id, sku) => {
    if (!window.confirm(`确认删除 SKU: ${sku} 的派单记录吗？`)) return;
    try {
      console.warn('Attempting to delete PurchaseRequest:', { id, sku });
      const obj = AV.Object.createWithoutData("PurchaseRequest", id);
      await obj.destroy();
      console.log('Successfully deleted PurchaseRequest:', { id, sku });
      alert("删除成功");
      fetchData();
    } catch (err) {
      console.error("删除失败：", err);
      alert("删除失败: " + (err.message || "未知错误"));
    }
  };

  const startEditing = (item) => {
    setEditingId(item.id);
    setEditedQuantity(item.quantity ? item.quantity.toString() : "");
    setEditedRemark(item.remark || "");
  };

  const saveChanges = async (id) => {
    if (!editedQuantity || parseInt(editedQuantity) <= 0) {
      alert("数量必须为正整数");
      return;
    }
    try {
      const obj = AV.Object.createWithoutData("PurchaseRequest", id);
      obj.set("quantity", parseInt(editedQuantity));
      obj.set("remark", editedRemark);
      await obj.save();
      console.log('Saved changes to PurchaseRequest:', { id, quantity: editedQuantity, remark: editedRemark });
      setEditingId(null);
      setEditedQuantity("");
      setEditedRemark("");
      fetchData();
    } catch (err) {
      console.error("保存失败：", err);
      alert("保存失败: " + (err.message || "未知错误"));
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditedQuantity("");
    setEditedRemark("");
  };

  const handleExport = () => {
    try {
      console.log('Starting export, filteredList length:', filteredList.length);
      if (!Array.isArray(filteredList)) {
        throw new Error('filteredList is not an array');
      }
      if (filteredList.length === 0) {
        alert('没有数据可导出');
        return;
      }
      const data = filteredList.map(item => ({
        SKU: item.sku || '-',
        派单数量: item.quantity || 0,
        国别: item.country || "-",
        备注: item.remark || "-",
        状态: item.status || '-',
        派单人: item.submittedBy || "-",
        派单时间: item.submittedAt ? new Date(item.submittedAt).toLocaleString() : "-",
      }));
      console.log('Export data prepared:', data);
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "DispatchRequests");
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'DispatchRequests.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      console.log('Export completed successfully');
    } catch (err) {
      console.error('Export failed:', err);
      alert('导出失败: ' + (err.message || '未知错误'));
    }
  };

  const getMonthOptions = () => {
    const options = ["全部"];
    const startYear = 2025;
    const startMonth = 5;
    for (let i = 0; i < 12; i++) {
      const monthOffset = startMonth + i - 1;
      const year = startYear + Math.floor(monthOffset / 12);
      const month = (monthOffset % 12) + 1;
      options.push(`${year}-${month}`);
    }
    return options;
  };

  useEffect(() => {
    let result = [...list];
    console.log('Applying filters:', { filterCountry, filterSubmittedBy, filterMonth, filterStatus, searchSku });
    if (filterCountry !== "全部") {
      result = result.filter(item => item.country === filterCountry);
    }
    if (filterSubmittedBy !== "全部") {
      result = result.filter(item => item.submittedBy === filterSubmittedBy);
    }
    if (filterMonth !== "全部") {
      result = result.filter(item => {
        if (!item.submittedAt) return false;
        const date = new Date(item.submittedAt);
        const monthYear = `${date.getFullYear()}-${date.getMonth() + 1}`;
        return monthYear === filterMonth;
      });
    }
    if (filterStatus !== "全部") {
      result = result.filter(item => item.status === filterStatus);
    }
    if (searchSku.trim()) {
      const searchLower = searchSku.toLowerCase();
      result = result.filter(item => item.sku?.toLowerCase().includes(searchLower));
    }
    console.log('Filtered list:', { count: result.length, data: result });
    setFilteredList(result);
    setCurrentPage(1);
  }, [list, filterCountry, filterSubmittedBy, filterMonth, filterStatus, searchSku]);

  const paginate = () => {
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    return filteredList.slice(start, end);
  };

  const renderPagination = () => {
    const totalPages = Math.ceil(filteredList.length / rowsPerPage);
    if (totalPages <= 1) return null;
    return (
      <div className="flex justify-center gap-2 mt-4 text-sm">
        <button
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 hover:bg-gray-300"
        >
          上一页
        </button>
        <span>
          第 {currentPage} 页 / 共 {totalPages} 页
        </span>
        <button
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 hover:bg-gray-300"
        >
          下一页
        </button>
      </div>
    );
  };

  const statusClasses = {
    '已提交': 'bg-blue-100 text-blue-800',
    '已采购': 'bg-purple-100 text-purple-800',
    '已入库': 'bg-green-100 text-green-800',
    '异常': 'bg-red-100 text-red-800',
    '待提交': 'bg-yellow-100 text-yellow-800'
  };

  const openProfileModal = (item) => {
    const key = `${item.country}-${item.sku}`;
    const profile = profileMap[key];
    if (profile) {
      setSelectedProfile(profile);
      setShowProfileModal(true);
    } else {
      alert("未找到对应产品的档案信息");
    }
  };

  const computeProfileProfit = (profile) => {
    const cur = currencyMap[profile.country] || { code: "USD", rate: 1 };
    const rawSale = profile.asinPrice != null && profile.asinPrice !== "" ? profile.asinPrice : profile.salePrice;
    const sale = Number(rawSale) || 0;
    if (sale <= 0) {
      return { gp: '0', rate: 0, rateDisplay: '-' };
    }
    const purchaseSite = (Number(profile.purchaseCost) || 0) * cur.rate;
    const first = Number(profile.firstCost) || 0;
    const last = Number(profile.lastCost) || 0;
    const adFee = ((Number(profile.adCost) || 0) / 100) * sale;
    const storageFee = ((Number(profile.storageCost) || 0) / 100) * sale;
    const returnFee = ((Number(profile.returnCost) || 0) / 100) * sale;
    const commissionFee = sale * COMMISSION_RATE;
    const total = purchaseSite + first + last + adFee + storageFee + returnFee + commissionFee;
    const gp = sale - total;
    const rate = sale > 0 ? gp / sale : 0;
    const rateDisplay = sale > 0 ? (rate * 100).toFixed(1) + "%" : "-";
    return { gp: gp.toFixed(2), rate, rateDisplay };
  };

  return (
    <div className="p-6 w-full min-h-screen bg-gray-100 rounded">
      <h1 className="text-3xl font-bold text-blue-800 mb-8 border-b pb-2">📝 运营派单</h1>
      <div className="flex w-full min-h-[600px] border border-gray-300 rounded overflow-hidden">
        <div className="w-[30%] bg-gray-50 border-r-2 border-gray-300 p-6 flex flex-col space-y-4">
          <label className="text-sm text-gray-700 mb-1 block font-medium">国别</label>
          <select
            name="country"
            value={form.country}
            onChange={e => setForm({ ...form, country: e.target.value })}
            className="border rounded px-3 py-2 bg-white w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="美国">美国</option>
            <option value="德国">德国</option>
            <option value="加拿大">加拿大</option>
            <option value="英国">英国</option>
            <option value="澳洲">澳洲</option>
            <option value="其他">其他</option>
          </select>
          <label className="text-sm text-gray-700 mb-1 block font-medium">SKU</label>
          <select
            value={form.sku}
            onChange={e => setForm({ ...form, sku: e.target.value })}
            className="border border-gray-300 rounded px-3 py-2 w-full focus:ring focus:ring-blue-200"
          >
            <option value="">选择 SKU</option>
            {skuOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="text-sm text-gray-700 mb-1 block font-medium">模板</label>
          <select
            value={selectedTemplateId}
            onChange={e => {
              const tid = e.target.value;
              setSelectedTemplateId(tid);
              if (tid) {
                const tpl = templateOptions.find(t => t.id === tid);
                if (tpl) {
                  calculateProfit(tpl);
                }
              } else {
                setProfitInfo({ gp: '-', rate: '-' });
              }
            }}
            className="border border-gray-300 rounded px-3 py-2 w-full focus:ring focus:ring-blue-200"
          >
            <option value="">选择模板</option>
            {templateOptions.map(t => (
              <option key={t.id} value={t.id}>{t.templateName || "(未命名)"}</option>
            ))}
          </select>
          <label className="text-sm text-gray-700 mb-1 block font-medium">数量</label>
          <input
            name="quantity"
            type="number"
            value={form.quantity}
            onChange={e => setForm({ ...form, quantity: e.target.value })}
            className="border border-gray-300 rounded px-3 py-2 w-full focus:ring focus:ring-blue-200"
            placeholder="请输入数量"
          />
          <label className="text-sm text-gray-700 mb-1 block font-medium">备注</label>
          <input
            name="remark"
            value={form.remark}
            onChange={e => setForm({ ...form, remark: e.target.value })}
            className="border border-gray-300 rounded px-3 py-2 w-full focus:ring focus:ring-blue-200"
            placeholder="可选备注"
          />
        
          <button onClick={handleSubmitRequest} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 shadow-sm w-full">保存派单</button>
        </div>

        <div className="w-[70%] bg-white p-6 flex flex-col">
          <div className="flex flex-wrap gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">按国别筛选</label>
              <select
                value={filterCountry}
                onChange={e => setFilterCountry(e.target.value)}
                className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {["全部", "美国", "德国", "加拿大", "英国", "澳洲", "其他"].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">按派单人筛选</label>
              <select
                value={filterSubmittedBy}
                onChange={e => setFilterSubmittedBy(e.target.value)}
                className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {submittedByOptions.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">按月份筛选</label>
              <select
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {getMonthOptions().map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">按状态筛选</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {["全部", "待提交", "已提交", "已采购", "已入库", "异常"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">搜索 SKU</label>
              <input
                type="text"
                value={searchSku}
                onChange={e => setSearchSku(e.target.value)}
                className="border rounded px-3 py-2 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="输入 SKU 进行模糊搜索"
              />
            </div>
            <button
              onClick={handleExport}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 shadow-sm self-end"
            >
              导出 Excel
            </button>
          </div>

          {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}
          {loading && <p className="text-gray-500 mb-4 text-sm">加载中...</p>}

          <table className="w-full border border-gray-200 rounded shadow-sm text-sm text-left">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <th className="px-4 py-2 border-b">SKU</th>
                <th className="px-4 py-2 border-b">派单数量</th>
                <th className="px-4 py-2 border-b">国别</th>
                <th className="px-4 py-2 border-b">备注</th>
                <th className="px-4 py-2 border-b">状态</th>
                <th className="px-4 py-2 border-b">派单人</th>
                <th className="px-4 py-2 border-b">派单时间</th>
                <th className="px-4 py-2 border-b">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center text-gray-500 py-4">暂无派单记录</td>
                </tr>
              ) : (
                paginate().map((item) => {
                  const key = `${item.country}-${item.sku}`;
                  const profile = profileMap[key];
                  const hasProfile = !!profile;
                  const profit = hasProfile ? computeProfileProfit(profile) : null;
                  const rowClass = hasProfile ? 'hover:bg-blue-50 cursor-pointer' : 'hover:bg-gray-50';
                  return (
                    <tr key={item.id} className={rowClass} onClick={() => hasProfile && openProfileModal(item)}>
                      <td className="px-4 py-2 border-b font-mono">{item.sku}</td>
                      <td className="px-4 py-2 border-b">
                        {editingId === item.id && item.status === '待提交' ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={editedQuantity}
                              onChange={(e) => setEditedQuantity(e.target.value)}
                              className="border border-gray-300 rounded px-2 py-1 w-20 text-sm focus:ring focus:ring-blue-200"
                              placeholder="数量"
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); saveChanges(item.id); }}
                              className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 text-xs"
                            >
                              保存
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); cancelEditing(); }}
                              className="text-gray-500 hover:underline text-xs"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <span
                            className={item.status === '待提交' ? 'cursor-pointer hover:underline' : ''}
                            onClick={(e) => { e.stopPropagation(); if (item.status === '待提交') startEditing(item); }}
                          >
                            {item.quantity}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 border-b">{item.country}</td>
                      <td className="px-4 py-2 border-b max-w-[150px] truncate" title={item.remark}>
                        {editingId === item.id && item.status === '待提交' ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={editedRemark}
                              onChange={e => setEditedRemark(e.target.value)}
                              className="border border-gray-300 rounded px-2 py-1 w-32 text-sm focus:ring focus:ring-blue-200"
                              placeholder="备注"
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); saveChanges(item.id); }}
                              className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 text-xs"
                            >
                              保存
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); cancelEditing(); }}
                              className="text-gray-500 hover:underline text-xs"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <span
                            className={item.status === '待提交' ? 'cursor-pointer hover:underline' : ''}
                            onClick={(e) => { e.stopPropagation(); if (item.status === '待提交') startEditing(item); }}
                            title={item.remark}
                          >
                            {item.remark || '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 border-b">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusClasses[item.status] || 'bg-yellow-100 text-yellow-800'}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 border-b text-gray-600">{item.submittedBy || '-'}</td>
                      <td className="px-4 py-2 border-b text-gray-500">{item.submittedAt ? new Date(item.submittedAt).toLocaleString() : '-'}</td>
                      <td className="px-4 py-2 border-b space-x-2">
                        {item.status === '待提交' ? (
                          <>
                            <button onClick={(e) => { e.stopPropagation(); submitRequest(item); }} className="text-blue-600 hover:underline text-xs">提交</button>
                            <button onClick={(e) => { e.stopPropagation(); deleteRequest(item.id, item.sku); }} className="text-red-600 hover:underline text-xs">删除</button>
                          </>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {renderPagination()}
        </div>
      </div>

      {/* Profile Modal */}
      {showProfileModal && selectedProfile && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl shadow-xl max-h-[90vh] overflow-auto">
            <h2 className="text-xl font-bold mb-5">产品档案: {selectedProfile.sku}</h2>
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div>
                <label>SKU</label>
                <input
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  value={selectedProfile.sku}
                  disabled
                />
              </div>
              <div>
                <label>国家</label>
                <input
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  value={selectedProfile.country}
                  disabled
                />
              </div>
              <div>
                <label>类目</label>
                <input
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  value={selectedProfile.category || '-'}
                  disabled
                />
              </div>
              <div>
                <label>ASIN</label>
                <input
                  className="w-full border rounded px-3 py-2 bg-gray-100 uppercase"
                  value={selectedProfile.asinValue || '-'}
                  disabled
                />
              </div>
              <div className="col-span-2">
                <label>产品尺寸 (cm) + 毛重(kg)</label>
                <div className="flex items-center gap-4 mt-1">
                  <div className="flex items-center gap-2">
                    <input
                      value={selectedProfile.lengthCm || ''}
                      className="w-20 border rounded px-3 py-2 bg-gray-100"
                      disabled
                    />
                    ×
                    <input
                      value={selectedProfile.widthCm || ''}
                      className="w-20 border rounded px-3 py-2 bg-gray-100"
                      disabled
                    />
                    ×
                    <input
                      value={selectedProfile.heightCm || ''}
                      className="w-20 border rounded px-3 py-2 bg-gray-100"
                      disabled
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span>毛重(kg)</span>
                    <input
                      value={selectedProfile.weightKg || ''}
                      className="w-24 border rounded px-3 py-2 bg-gray-100"
                      disabled
                    />
                  </div>
                </div>
              </div>
              <div className="col-span-2">
                <label>运费 (RMB)</label>
                <div className="flex items-center gap-4 mt-1">
                  <input
                    value={selectedProfile.freightPrice || ''}
                    className="w-40 border rounded px-3 py-2 bg-gray-100"
                    disabled
                  />
                  <span>/</span>
                  <input
                    value={selectedProfile.freightType || 'kg'}
                    className="border rounded px-3 py-2 bg-gray-100 w-20"
                    disabled
                  />
                </div>
              </div>
              <div>
                <label>售价（USD）</label>
                <input
                  value={selectedProfile.salePrice || ''}
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  disabled
                />
              </div>
              <div>
                <label>采购成本（RMB）</label>
                <input
                  value={selectedProfile.purchaseCost || ''}
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  disabled
                />
              </div>
              <div>
                <label>头程（USD）</label>
                <input
                  value={selectedProfile.firstCost || ''}
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  disabled
                />
              </div>
              <div>
                <label>尾程（USD）</label>
                <input
                  value={selectedProfile.lastCost || ''}
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  disabled
                />
              </div>
              <div>
                <label>广告预估（%）</label>
                <input
                  value={selectedProfile.adCost || ''}
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  disabled
                />
              </div>
              <div>
                <label>仓储预估（%）</label>
                <input
                  value={selectedProfile.storageCost || ''}
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  disabled
                />
              </div>
              <div>
                <label>退款预估（%）</label>
                <input
                  value={selectedProfile.returnCost || ''}
                  className="w-full border rounded px-3 py-2 bg-gray-100"
                  disabled
                />
              </div>
            </div>
            {selectedProfile && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-bold mb-2">利润计算</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label>实时价格</label>
                    <input
                      value={selectedProfile.asinPrice ? `$${selectedProfile.asinPrice}` : '-'}
                      className="w-full border rounded px-3 py-2 bg-gray-100"
                      disabled
                    />
                  </div>
                  <div>
                    <label>用于计算售价</label>
                    <input
                      value={
                        selectedProfile.asinPrice != null && selectedProfile.asinPrice !== ""
                          ? `${selectedProfile.asinPrice} ${currencyMap[selectedProfile.country]?.code || 'USD'}`
                          : '-'
                      }
                      className="w-full border rounded px-3 py-2 bg-gray-100"
                      disabled
                    />
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <p><strong>毛利润:</strong> {computeProfileProfit(selectedProfile).gp} {currencyMap[selectedProfile.country]?.code || 'USD'}</p>
                  <p><strong>毛利率:</strong> {computeProfileProfit(selectedProfile).rateDisplay}</p>
                </div>
              </div>
            )}
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
