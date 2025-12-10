import React, { useEffect, useState, useMemo } from "react";
// 导入 LeanCloud 实例。请确保您的本地环境正确配置了路径解析。
// 如果持续报错 "Could not resolve ../leancloud"，请检查文件路径是否正确，
// 并确保 leancloud-storage 依赖已安装。
import AV from "../leancloud"; 
import { useNavigate } from "react-router-dom"; // 导入 useNavigate 用于页面跳转
import * as XLSX from 'xlsx'; // 导入 XLSX 库。请确保已通过 npm install xlsx 或 yarn add xlsx 安装此库。

// Feishu bot webhook URL
const FEISHU_WEBHOOK_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/fc27a40e-fa75-4539-b542-857eb145a873'; // 已更新为新地址

// 文件图标辅助函数
const getFileIcon = (filename) => {
  if (!filename) return ' ';
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx'].includes(ext)) return '📊';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext)) return '🖼️';
  return '📁';
};

// 日期格式化辅助函数
const formatDate = (dateValue) => {
  if (!dateValue) return "-";
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
};

// 状态映射函数
const displayStatus = (status) => status === "已发货" ? "已出库" : status;

// 状态徽章组件（使用图标）
function StatusBadge({ status }) {
  const base = "px-2 py-1 text-sm rounded-full font-medium flex items-center justify-center";
  const statusMap = {
    "待提交": { icon: "⏳", color: "bg-yellow-100 text-yellow-800" },
    "已提交": { icon: "📤", color: "bg-blue-100 text-blue-800" },
    "已撤回": { icon: "↩️", color: "bg-gray-200 text-gray-800" },
    "已出库": { icon: "✅", color: "bg-purple-100 text-purple-800" },
    "异常": { icon: "⚠️", color: "bg-red-100 text-red-800" },
  };
  const { icon, color } = statusMap[displayStatus(status)] || { icon: "❓", color: "bg-gray-100 text-gray-800" };
  return <span className={`${base} ${color}`} title={displayStatus(status)}>{icon}</span>;
}

// 国别颜色映射（保留以备他用）
const getCountryColor = (country) => {
  const map = {
    "美国": "bg-blue-100",
    "加拿大": "bg-red-100",
    "英国": "bg-green-100",
    "德国": "bg-yellow-100",
    "澳洲": "bg-purple-100",
    "其他": "bg-gray-100",
  };
  return map[country] || "bg-gray-100";
};

// 通用区块标题
function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-blue-800 mb-4 border-b pb-2">{title}</h2>
      {children || <p className="text-sm text-gray-400 italic">暂无内容</p>}
    </div>
  );
}

// 自定义确认模态框组件
function CustomConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg p-6 shadow-lg w-full max-w-sm">
        <p className="text-lg font-semibold mb-4">{message}</p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300 transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OutboundManagePage() {
  const [stockList, setStockList] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({
    fba: "",
    skuCount: 1,
    skus: [""],
    country: "美国",
    quantity: "",
    cartonCount: "",
    volume: "",
    grossWeight: "",
    warehousePosition: "", // 新增仓位字段
    files: [],
    warehouse: "知客仓",
    logistics: "",
    feishuNotification: "" // 新增状态：群内提醒
  });
  const [modalForm, setModalForm] = useState({ 
    warehouse: "知客仓", 
    logistics: "",
    partialSkus: new Set() // 新增状态，用于存储部分出库的SKU
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 模态框状态
  const [showModal, setShowModal] = useState(false);
  const [modalOrder, setModalOrder] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // 确认模态框状态
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState("");

  // 筛选状态
  const [filter, setFilter] = useState({
    country: "全部",
    month: "全部",
    status: "全部",
    submittedBy: "全部"
  });

  // 物流渠道选项
  const logisticsOptions = ["海卡自税", "海卡不包税", "海卡包税", "海派", "铁卡自税", "铁卡包税", "卡航自税", "快船包税", "空运"];

  const navigate = useNavigate(); // 初始化 useNavigate 钩子

  // 设置页面标题
  useEffect(() => {
    document.title = "Kunpeng System";
    return () => {
      document.title = "Order System";
    };
  }, []);

  // 拉取库存
  const fetchStock = async () => {
    try {
      const q = new AV.Query("StockItem");
      q.ascending("sku").limit(1000);
      const res = await q.find();
      setStockList(res.map(i => ({
        sku: i.get("sku"),
        quantity: i.get("quantity") || 0
      })));
    } catch (e) {
      console.error("获取库存失败", e);
      setError("获取库存失败，请检查网络或联系管理员");
    }
  };

  // 拉取出库记录
  const fetchOrders = async () => {
    try {
      const q = new AV.Query("OutboundRequest");
      q.descending("createdAt").limit(500);
      const res = await q.find();
      setOrders(res.map(o => ({ id: o.id, ...o.toJSON() })));
    } catch (e) {
      console.error("获取出库记录失败", e);
      setError("获取出库记录失败，请检查网络或联系管理员");
    }
  };

  useEffect(() => {
    fetchStock();
    fetchOrders();
  }, []);

  // 通用表单 change
  const handleChange = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    setError("");
  };

  // 模态框表单 change
  const handleModalChange = e => {
    const { name, value } = e.target;
    setModalForm(f => {
      const newForm = { ...f, [name]: value };
      // 如果仓库选择改变，并且新选择不是“部分知客仓”，清空部分SKU选择
      if (name === "warehouse" && value !== "部分知客仓") {
        newForm.partialSkus = new Set();
      }
      return newForm;
    });
    setError("");
  };

  // 模态框 SKU 多选处理
  const handlePartialSkuChange = (sku, isChecked) => {
    setModalForm(f => {
      const newSet = new Set(f.partialSkus);
      if (isChecked) {
        newSet.add(sku);
      } else {
        newSet.delete(sku);
      }
      return { ...f, partialSkus: newSet };
    });
    setError(""); // 清除错误提示
  };

  // 筛选 change
  const handleFilterChange = e => {
    const { name, value } = e.target;
    setFilter(f => ({ ...f, [name]: value }));
    setError("");
  };

  // SKU 数量变化
  const handleSkuCountChange = e => {
    const count = parseInt(e.target.value, 10);
    setForm(f => {
      const skus = [...f.skus];
      while (skus.length < count) skus.push("");
      skus.length = count;
      return { ...f, skuCount: count, skus };
    });
    setError("");
  };

  // 单行 SKU 选择
  const handleSkuSelect = (idx, value) => {
    setForm(f => {
      const skus = [...f.skus];
      skus[idx] = value;
      return { ...f, skus };
    });
    setError("");
  };

  // 文件上传
  const handleFileChange = e => {
    const files = Array.from(e.target.files).slice(0, 5 - form.files.length);
    setForm(f => ({ ...f, files: [...f.files, ...files] }));
    e.target.value = null;
  };

  const removeFile = idx => {
    setForm(f => ({ ...f, files: f.files.filter((_, i) => i !== idx) }));
  };

  // 新增：从xlsx文件中提取数据
  const extractFromXLSX = async (xlsxFile) => {
    try {
      const arrayBuffer = await xlsxFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = '系统导入模板';
      if (!workbook.SheetNames.includes(sheetName)) {
        setError('未找到“系统导入模板”工作表');
        return;
      }
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

      // 初始化 extractData
      const extractData = {};

      // 提取 A1 的全部文本到群内提醒
      if (jsonData.length > 0 && jsonData[0].length > 0) {
        extractData.feishuNotification = jsonData[0][0] || '';
      }

      // 从第11行（索引10）开始提取自动部分
      const extractStartRow = 10; // row11 对应索引10
      for (let i = extractStartRow; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (row.length > 0) {
          const label = row[0]; // A列标签
          const value = row[1]; // B列值
          if (label && value !== undefined && value !== null && value !== '') {
            // 清理标签：移除冒号和空格
            const cleanLabel = label.replace(/：|:/g, '').trim();
            // 映射到表单字段
            switch (cleanLabel) {
              case '货件编号':
                extractData.fba = value.trim();
                break;
              case '总数量':
                extractData.quantity = value.toString().trim();
                break;
              case '总箱数':
                extractData.cartonCount = value.toString().trim();
                break;
              case '总体积':
                extractData.volume = value.toString().trim();
                break;
              case '总毛重':
                extractData.grossWeight = value.toString().trim();
                break;
              case '仓位':
                extractData.warehousePosition = value.trim();
                break;
              default:
                // 忽略其他
                break;
            }
          }
        }
      }

      // 更新表单
      setForm(prev => ({ ...prev, ...extractData }));
      setError(''); // 清除错误
    } catch (err) {
      console.error('提取数据失败:', err);
      setError('提取数据失败，请检查文件格式');
    }
  };

  // 发送飞书通知
  const sendFeishuNotification = async (message) => {
    if (!message.trim()) return;

    try {
      const response = await fetch(FEISHU_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msg_type: 'text',
          content: {
            text: message
          }
        }),
      });

      const data = await response.json();
      if (data.code !== 0) {
        console.error("发送飞书通知失败:", data);
        // 可以选择在这里给用户一个不影响主要操作的提示
      } else {
        console.log("飞书通知发送成功:", data);
      }
    } catch (e) {
      console.error("发送飞书通知时发生错误:", e);
    }
  };

  // 提交出库请求 (新增需求)
  const handleSubmit = async () => {
    if (!form.fba.trim()) return setError("请输入 FBA 号");
    if (form.skus.some(sku => !sku)) return setError("请为每一行选择 SKU");
    if (!form.quantity || isNaN(+form.quantity) || +form.quantity <= 0)
      return setError("请输入有效总数量");
    if (form.cartonCount && (isNaN(+form.cartonCount) || +form.cartonCount < 0 || !Number.isInteger(+form.cartonCount)))
      return setError("总箱数必须为非负整数");
    if (form.volume && (isNaN(+form.volume) || +form.volume < 0))
      return setError("总体积必须为非负数");
    if (form.grossWeight && (isNaN(+form.grossWeight) || +form.grossWeight < 0))
      return setError("总毛重必须为非负数");
    if (!form.warehouse) return setError("请选择出库仓库");

    const totalStock = form.skus.reduce((sum, sku) => {
      const item = stockList.find(s => s.sku === sku);
      return sum + (item ? item.quantity : 0);
    }, 0);
    if (+form.quantity > totalStock)
      return setError(`总数量超出所选 SKU 库存总和（${totalStock}）`);

    setIsSubmitting(true);
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const Out = AV.Object.extend("OutboundRequest");
      const obj = new Out();

      obj.set("fba", form.fba.trim());
      obj.set("skus", form.skus);
      obj.set("country", form.country);
      obj.set("quantity", +form.quantity);
      obj.set("cartonCount", form.cartonCount ? +form.cartonCount : 0);
      obj.set("volume", form.volume ? +form.volume : 0);
      obj.set("grossWeight", form.grossWeight ? +form.grossWeight : 0);
      obj.set("warehousePosition", form.warehousePosition || ""); // 新增保存仓位
      obj.set("warehouse", form.warehouse);
      obj.set("logistics", form.logistics);
      obj.set("submittedBy", user.username || "未知");
      obj.set("submittedAt", new Date());
      obj.set("status", "待提交");
      // 保存群内提醒，但不在此时发送
      obj.set("feishuNotification", form.feishuNotification.trim() || "");

      if (form.files.length) {
        const fileList = [];
        for (let f of form.files) {
          const af = new AV.File(f.name, f);
          await af.save();
          fileList.push({ name: f.name, url: af.url() });
        }
        obj.set("fileList", fileList);
      }

      await obj.save();

      setForm({
        fba: "",
        skuCount: 1,
        skus: [""],
        country: "美国",
        quantity: "",
        cartonCount: "",
        volume: "",
        grossWeight: "",
        warehousePosition: "", // 清空仓位
        files: [],
        warehouse: "知客仓",
        logistics: "",
        feishuNotification: "" // 清空群内提醒
      });
      fetchOrders();
      setShowAddModal(false);
    } catch (e) {
      console.error("提交失败", e);
      setError("提交失败，请检查网络或联系管理员");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 模态框打开/关闭
  const openModal = order => {
    setModalOrder(order);
    setModalForm({
      warehouse: order.warehouse || "知客仓",
      logistics: order.logistics || "",
      partialSkus: new Set() // 打开模态框时清空选择
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalOrder(null);
    setModalForm({ warehouse: "知客仓", logistics: "", partialSkus: new Set() }); // 关闭时也清空 SKU 选择
    setError("");
  };

  // 新增出库模态框关闭
  const closeAddModal = () => {
    setShowAddModal(false);
    setForm({
      fba: "",
      skuCount: 1,
      skus: [""],
      country: "美国",
      quantity: "",
      cartonCount: "",
      volume: "",
      grossWeight: "",
      warehousePosition: "", // 清空仓位
      files: [],
      warehouse: "知客仓",
      logistics: "",
      feishuNotification: "" // 清空群内提醒
    });
    setError("");
  };

  // 模态框操作：提交 & 删除
  const handleModalSubmit = async () => {
    if (!modalOrder) return;
    if (!modalForm.warehouse) return setError("请选择出库仓库");

    // 根据仓库类型进行不同的验证和操作
    if (modalForm.warehouse === "知客仓") {
      if (!modalForm.logistics) return setError("请选择物流渠道");
    } else if (modalForm.warehouse === "部分知客仓") {
      if (modalForm.partialSkus.size === 0) {
        return setError("选择‘部分知客仓’时，请至少选择一个 SKU");
      }
    }

    setModalLoading(true);
    try {
      const obj = AV.Object.createWithoutData("OutboundRequest", modalOrder.id);
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      obj.set("warehouse", modalForm.warehouse);
      obj.set("logistics", modalForm.logistics); // 即使是部分知客仓也可能需要记录物流，如果不需要，可以在这里条件性设置

      // 更新状态和提交信息
      if (modalOrder.status === "待提交") {
        obj.set("status", "已提交");
        obj.set("submittedBy", user.username || "未知");
        obj.set("submittedAt", new Date());
      }
      
      await obj.save(); // 保存仓库和物流信息到当前订单

      // 在这里判断并发送飞书通知
      if (modalOrder.feishuNotification && modalOrder.feishuNotification.trim()) {
        await sendFeishuNotification(
          `出库提醒：FBA号 ${modalOrder.fba}，SKU: ${modalOrder.skus.join(', ')}，数量: ${modalOrder.quantity}。\n信息简报：${modalOrder.feishuNotification}`
        );
      }

      // 如果是“部分知客仓”，直接关闭模态框，不进行页面跳转
      if (modalForm.warehouse === "部分知客仓") {
        closeModal();
      } else {
        // 其他仓库选项（知客仓或非知客仓），直接刷新订单列表并关闭模态框
        fetchOrders();
        closeModal();
      }

    }
    catch (e) {
      console.error("提交失败", e);
      setError("提交失败，请检查网络或联系管理员");
    } finally {
      setModalLoading(false);
    }
  };

  const handleModalDelete = async () => {
    if (!modalOrder) return;
    setConfirmMessage("确认删除此记录？");
    setConfirmAction(() => async () => { // 存储确认后的操作
      setModalLoading(true);
      try {
        const obj = AV.Object.createWithoutData("OutboundRequest", modalOrder.id);
        await obj.destroy();
        fetchOrders();
        closeModal();
      } catch (e) {
        console.error("删除失败", e);
        setError("删除失败，请检查网络或联系管理员");
      } finally {
        setModalLoading(false);
      }
    });
    setShowConfirmModal(true);
  };

  // 手动确认出库
  const handleManualConfirmOutbound = async () => {
    if (!modalOrder) return;
    setConfirmMessage("确认手动将此订单标记为已出库？");
    setConfirmAction(() => async () => { // 存储确认后的操作
      setModalLoading(true);
      try {
        const obj = AV.Object.createWithoutData("OutboundRequest", modalOrder.id);
        obj.set("status", "已出库");
        await obj.save();
        fetchOrders();
        closeModal();
      } catch (e) {
        console.error("手动确认出库失败", e);
        setError("手动确认出库失败，请检查网络或联系管理员");
      } finally {
        setModalLoading(false);
      }
    });
    setShowConfirmModal(true);
  };

  // 处理自定义确认框的确认和取消
  const onConfirmAction = () => {
    if (confirmAction) {
      confirmAction();
    }
    setShowConfirmModal(false);
    setConfirmAction(null);
    setConfirmMessage("");
  };

  const onCancelAction = () => {
    setShowConfirmModal(false);
    setConfirmAction(null);
    setConfirmMessage("");
  };


  // 生成 2025-05 及之后的月份
  const getRecentMonths = () => {
    const months = ["全部"];
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-indexed
    for (let year = 2025; year <= currentYear; year++) {
      const startMonth = year === 2025 ? 4 : 0; // 2025年从5月（索引4）开始，其他年份从1月（索引0）开始
      const endMonth = year === currentYear ? currentMonth : 11; // 当前年份到当前月份，其他年份到12月
      for (let month = startMonth; month <= endMonth; month++) {
        months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
      }
    }
    return months;
  };

  // 获取唯一提交人
  const submitters = useMemo(() => {
    const set = new Set(orders.map(o => o.submittedBy));
    return ["全部", ...Array.from(set).sort()];
  }, [orders]);

  // 筛选订单
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const matchesCountry = filter.country === "全部" || o.country === filter.country;
      const matchesMonth = filter.month === "全部" ||
        (o.submittedAt && new Date(o.submittedAt).toISOString().slice(0, 7) === filter.month);
      const matchesStatus = filter.status === "全部" || displayStatus(o.status) === filter.status;
      const matchesSubmitter = filter.submittedBy === "全部" || o.submittedBy === filter.submittedBy;
      return matchesCountry && matchesMonth && matchesStatus && matchesSubmitter;
    });
  }, [orders, filter]);

  return (
    <div className="p-6 w-full min-h-screen bg-gray-100 rounded shadow">
      <h1 className="text-3xl font-bold text-blue-800 mb-8 border-b pb-2">📤 出库请求提交与管理</h1>
      <div className="w-full bg-white p-6">
        <Section title="📋 出库记录（双击查看）">
          <div className="mb-4">
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
            >
              新增出库需求
            </button>
          </div>
          <div className="flex gap-3 mb-4">
            <div>
              <label className="block text-[11px] font-medium mb-1">国家</label>
              <select
                name="country"
                value={filter.country}
                onChange={handleFilterChange}
                className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
              >
                {["全部", "美国", "加拿大", "英国", "德国", "澳洲", "其他"].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1">提交月份</label>
              <select
                name="month"
                value={filter.month}
                onChange={handleFilterChange}
                className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
              >
                {getRecentMonths().map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1">状态</label>
              <select
                name="status"
                value={filter.status}
                onChange={handleFilterChange}
                className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
              >
                {["全部", "待提交", "已提交", "已撤回", "已出库", "异常"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1">提交人</label>
              <select
                name="submittedBy"
                value={filter.submittedBy}
                onChange={handleFilterChange}
                className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
              >
                {submitters.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border rounded text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 border-b">FBA号</th>
                  <th className="px-3 py-2 border-b">出库仓库</th>
                  <th className="px-3 py-2 border-b">SKUs</th>
                  <th className="px-3 py-2 border-b">国别</th>
                  <th className="px-3 py-2 border-b">总数量</th>
                  <th className="px-3 py-2 border-b">状态</th>
                  <th className="px-3 py-2 border-b">提交时间</th>
                  <th className="px-3 py-2 border-b">物流</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="text-center py-4 text-gray-500">暂无出库记录</td>
                  </tr>
                ) : (
                  filteredOrders.map(o => (
                    <tr
                      key={o.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onDoubleClick={() => openModal(o)}
                    >
                      <td className="px-3 py-2 border-b">{o.fba}</td>
                      <td className="px-3 py-2 border-b">{o.warehouse || "-"}</td>
                      <td className="px-3 py-2 border-b">
                        {Array.isArray(o.skus) ? o.skus.slice(0, 5).join(", ") : o.sku}
                      </td>
                      <td className="px-3 py-2 border-b">
                        {o.country}
                      </td>
                      <td className="px-3 py-2 border-b">{o.quantity}</td>
                      <td className="px-3 py-2 border-b">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-3 py-2 border-b">{formatDate(o.submittedAt)}</td>
                      <td className="px-3 py-2 border-b">{o.logistics || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {error && !showAddModal && !showModal && <p className="text-red-600 text-sm mt-4">{error}</p>}
        </Section>
      </div>
      {/* 新增出库模态框 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg w-2/5 max-h-[80vh] overflow-y-auto p-6 relative">
            <button onClick={closeAddModal} className="absolute top-3 right-3 text-gray-500 hover:text-gray-800">×</button>
            <h3 className="text-xl font-semibold mb-4">新增出库需求</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-[11px] font-medium mb-1">
                  出库仓库 <span className="text-red-500">*</span>
                </label>
                <select
                  name="warehouse"
                  value={form.warehouse}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                >
                  <option value="知客仓">知客仓</option>
                  <option value="非知客仓">非知客仓</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">
                  FBA号 <span className="text-red-500">*</span>
                </label>
                <input
                  name="fba"
                  value={form.fba}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="请输入 FBA 号"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">
                  SKU 数量 <span className="text-red-500">*</span>
                </label>
                <select
                  name="skuCount"
                  value={form.skuCount}
                  onChange={handleSkuCountChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              {form.skus.map((skuVal, idx) => (
                <div key={idx}>
                  <label className="block text-[11px] font-medium mb-1">
                    SKU {idx + 1} <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={skuVal}
                    onChange={e => handleSkuSelect(idx, e.target.value)}
                    className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  >
                    <option value="">选择 SKU</option>
                    {/* 只显示有库存的SKU */}
                    {stockList.filter(s => s.quantity > 0).map(s => (
                      <option key={s.sku} value={s.sku}>
                        {s.sku}（库存 {s.quantity}）
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div>
                <label className="block text-[11px] font-medium mb-1">国别</label>
                <select
                  name="country"
                  value={form.country}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                >
                  {["美国", "加拿大", "英国", "德国", "澳洲", "其他"].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">
                  总数量 <span className="text-red-500">*</span>
                </label>
                <input
                  name="quantity"
                  type="number"
                  value={form.quantity}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="请输入总出库数量"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">总箱数</label>
                <input
                  name="cartonCount"
                  type="number"
                  min="0"
                  step="1"
                  value={form.cartonCount}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="请输入总箱数"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">总体积 (m³)</label>
                <input
                  name="volume"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.volume}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="请输入总体积"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">总毛重 (kg)</label>
                <input
                  name="grossWeight"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.grossWeight}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="请输入总毛重"
                />
              </div>
              {/* 新增仓位输入框 */}
              <div>
                <label className="block text-[11px] font-medium mb-1">仓位</label>
                <input
                  name="warehousePosition"
                  type="text"
                  value={form.warehousePosition}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="请输入仓位"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">指定物流</label>
                <select
                  name="logistics"
                  value={form.logistics}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                >
                  <option value="">请选择</option>
                  {logisticsOptions.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              {/* 新增群内提醒输入框 */}
              <div>
                <label className="block text-[11px] font-medium mb-1">群内提醒</label>
                <textarea
                  name="feishuNotification"
                  value={form.feishuNotification}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="输入要发送到飞书群的提醒消息"
                  rows="3"
                ></textarea>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1">
                  上传文件（最多5个）
                </label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                  onChange={handleFileChange}
                  className="w-full file:rounded-full file:bg-blue-50 file:text-blue-700 file:text-xs file:py-1"
                />
                <div className="mt-1 space-y-1 max-h-20 overflow-y-auto">
                  {form.files.map((f, i) => {
                    const isXlsx = f.name.toLowerCase().endsWith('.xlsx');
                    return (
                      <div key={i} className="flex items-center bg-gray-100 px-2 py-1 rounded text-[11px]">
                        <span className="truncate mr-2 flex-1" title={f.name}>
                          {getFileIcon(f.name)} {f.name}
                        </span>
                        {isXlsx && (
                          <button
                            onClick={() => extractFromXLSX(f)}
                            className="ml-2 bg-green-500 text-white px-2 py-1 rounded text-xs hover:bg-green-600"
                          >
                            自动提取数据
                          </button>
                        )}
                        <button onClick={() => removeFile(i)} className="ml-2 text-red-500">×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
              {error && <p className="text-red-600 text-[11px]">{error}</p>}
              <div className="flex justify-end gap-3">
                <button
                  onClick={closeAddModal}
                  className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-300"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className={`bg-blue-600 text-white px-4 py-2 rounded text-sm ${isSubmitting ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"}`}
                >
                  {isSubmitting ? "提交中..." : "提交出库"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 详情模态框 */}
      {showModal && modalOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg w-3/5 max-h-[80vh] overflow-y-auto p-6 relative">
            <button onClick={closeModal} className="absolute top-3 right-3 text-gray-500 hover:text-gray-800">×</button>
            <h3 className="text-xl font-semibold mb-4">出库记录详情</h3>
            <div className="space-y-2 text-sm">
              <div>
                <label className="block text-[11px] font-medium mb-1">
                  出库仓库 <span className="text-red-500">*</span>
                </label>
                <select
                  name="warehouse"
                  value={modalForm.warehouse}
                  onChange={handleModalChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                >
                  <option value="知客仓">知客仓</option>
                  <option value="部分知客仓">部分知客仓</option> {/* 新增选项 */}
                  <option value="非知客仓">非知客仓</option>
                </select>
              </div>
              {/* 根据选择的仓库显示 SKU 多选框 */}
              {modalForm.warehouse === "部分知客仓" && (
                <div className="border border-blue-200 p-3 rounded bg-blue-50">
                  <p className="block text-[11px] font-medium mb-2">选择需要出库的 SKU（当前出库记录中）：</p>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                    {Array.isArray(modalOrder.skus) && modalOrder.skus.length > 0 ? (
                      modalOrder.skus.map((sku, idx) => (
                        <div key={idx} className="flex items-center">
                          <input
                            type="checkbox"
                            id={`sku-checkbox-${modalOrder.id}-${idx}`} // 确保 ID 唯一
                            checked={modalForm.partialSkus.has(sku)}
                            onChange={(e) => handlePartialSkuChange(sku, e.target.checked)}
                            className="mr-2"
                          />
                          <label htmlFor={`sku-checkbox-${modalOrder.id}-${idx}`} className="text-sm">{sku}</label>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-gray-500">当前记录没有关联 SKU。</p>
                    )}
                  </div>
                </div>
              )}
              {/* 只有非部分知客仓才显示物流渠道，因为部分知客仓的物流可能在 WarehouseActionPage 处理 */}
              {modalForm.warehouse !== "部分知客仓" && ( 
                <div>
                  <label className="block text-[11px] font-medium mb-1">
                    选择物流 <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="logistics"
                    value={modalForm.logistics}
                    onChange={handleModalChange}
                    className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  >
                    <option value="">请选择</option>
                    {logisticsOptions.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <p><strong>FBA号：</strong>{modalOrder.fba}</p>
              <p><strong>SKUs：：</strong>{Array.isArray(modalOrder.skus) ? modalOrder.skus.join(", ") : modalOrder.sku}</p>
              <p><strong>国别：：</strong>{modalOrder.country}</p>
              <p><strong>总数量：：</strong>{modalOrder.quantity}</p>
              <p><strong>总箱数：：</strong>{modalOrder.cartonCount || '-'}</p>
              <p><strong>总体积：：</strong>{modalOrder.volume ? modalOrder.volume.toFixed(2) + ' m³' : '-'}</p>
              <p><strong>总毛重：：</strong>{modalOrder.grossWeight ? modalOrder.grossWeight.toFixed(2) + ' kg' : '-'}</p>
              {/* 新增仓位显示 */}
              <p><strong>仓位：：</strong>{modalOrder.warehousePosition || '-'}</p>
              <p><strong>状态：：</strong><StatusBadge status={modalOrder.status} /></p>
              <p><strong>提交人：：</strong>{modalOrder.submittedBy}</p>
              <p><strong>提交时间：：</strong>{formatDate(modalOrder.submittedAt)}</p>
              {modalOrder.fileList?.length > 0 && (
                <>
                  <strong>附件：：</strong>
                  <ul className="list-disc pl-5">
                    {modalOrder.fileList.map((f, i) => (
                      <li key={i}>
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600">
                          {getFileIcon(f.name)} {f.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={handleModalSubmit}
                // 提交按钮的 disabled 逻辑：加载中，或状态不允许提交，或知客仓未选物流，或部分知客仓未选SKU
                disabled={modalLoading || !["待提交", "已提交"].includes(modalOrder.status) || (modalForm.warehouse === "知客仓" && !modalForm.logistics) || (modalForm.warehouse === "部分知客仓" && modalForm.partialSkus.size === 0)}
                className={`bg-blue-800 text-white px-4 py-2 rounded text-sm ${
                  modalLoading || !["待提交", "已提交"].includes(modalOrder.status) || (modalForm.warehouse === "知客仓" && !modalForm.logistics) || (modalForm.warehouse === "部分知客仓" && modalForm.partialSkus.size === 0)
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-blue-900"
                }`}
              >
                {modalLoading ? "提交中..." : "提交"}
              </button>
              {modalOrder.status === "已提交" && modalForm.warehouse === "非知客仓" && (
                <button
                  onClick={handleManualConfirmOutbound}
                  disabled={modalLoading}
                  className={`bg-green-600 text-white px-4 py-2 rounded text-sm ${modalLoading ? "opacity-50 cursor-not-allowed" : "hover:bg-green-700"}`}
                >
                  {modalLoading ? "处理中..." : "手动确认出库"}
                </button>
              )}
              <button
                onClick={handleModalDelete}
                disabled={modalLoading}
                className={`bg-gray-500 text-white px-4 py-2 rounded text-sm ${modalLoading ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-600"}`}
              >
                {modalLoading ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 自定义确认模态框渲染 */}
      {showConfirmModal && (
        <CustomConfirmModal
          message={confirmMessage}
          onConfirm={onConfirmAction}
          onCancel={onCancelAction}
        />
      )}
    </div>
  );
}