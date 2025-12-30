import { useEffect, useState, useRef } from "react";
import AV from "../leancloud";

function StatusBadge({ status }) {
  const base = "px-2 py-0.5 text-xs rounded-full font-medium";
  if (status?.startsWith("已采购")) return <span className={`${base} bg-blue-100 text-blue-800`}>{status}</span>;
  if (status?.startsWith("剩余")) return <span className={`${base} bg-gray-100 text-gray-800`}>{status}</span>;
  if (status === "异常") return <span className={`${base} bg-red-100 text-red-800`}>{status}</span>;
  if (status === "已提交") return <span className={`${base} bg-yellow-100 text-yellow-800`}>{status}</span>;
  if (status === "已入库") return <span className={`${base} bg-green-100 text-green-800`}>{status}</span>;
  if (status === "已终止") return <span className={`${base} bg-gray-200 text-gray-800`}>{status}</span>;
  return <span className={`${base} bg-gray-100 text-gray-800`}>{status || '-'}</span>;
}

function CountryBadge({ country }) {
  const base = "px-2 py-0.5 text-xs rounded-full font-medium";
  switch (country) {
    case "美国":
      return <span className={`${base} bg-blue-100 text-blue-800`}>国别: {country}</span>;
    case "德国":
      return <span className={`${base} bg-gray-100 text-gray-800`}>国别: {country}</span>;
    case "加拿大":
      return <span className={`${base} bg-red-100 text-red-800`}>国别: {country}</span>;
    case "英国":
      return <span className={`${base} bg-purple-100 text-purple-800`}>国别: {country}</span>;
    case "澳洲":
      return <span className={`${base} bg-green-100 text-green-800`}>国别: {country}</span>;
    case "其他":
      return <span className={`${base} bg-orange-100 text-orange-800`}>国别: {country}</span>;
    default:
      return <span className={`${base} bg-gray-100 text-gray-800`}>国别: {country || '-'}</span>;
  }
}

// 新增：扣除资金函数（移植自 FundManagementPage 的 handlePurchaseDeduct）
const deductFunds = async (site, poNumber, sku, amount) => {
  if (amount <= 0) {
    console.warn("扣除金额必须大于0，跳过");
    return;
  }
  try {
    const transaction = new AV.Object("FundTransaction");
    transaction.set("site", site);
    transaction.set("type", "采购扣除");
    transaction.set("amount", -amount); // 负数表示扣除
    transaction.set("description", `采购订单 ${poNumber} (${sku})`);
    await transaction.save();
    console.log(`创建交易记录: ${site} - 采购扣除 ¥${amount.toFixed(2)}`);

    // 更新 SiteFund balance
    const q = new AV.Query("SiteFund");
    q.equalTo("site", site);
    const existing = await q.first();
    let newBalance;
    if (existing) {
      const currentBalance = existing.attributes.balance || 0;
      newBalance = currentBalance - amount;
      existing.set("balance", newBalance);
      await existing.save();
    } else {
      // 创建新记录
      const fundRecord = new AV.Object("SiteFund");
      fundRecord.set("site", site);
      fundRecord.set("balance", -amount);
      fundRecord.set("actualPaid", 0);
      await fundRecord.save();
      newBalance = -amount;
    }
    console.log(`更新余额成功: ${site} 新余额 ¥${newBalance.toFixed(2)}`);
  } catch (err) {
    console.error("扣除资金失败:", err);
    alert(`扣除资金失败: ${err.message}`);
  }
};

export default function PurchaseManagePage() {
  const [allList, setAllList] = useState([]);
  const [submittedList, setSubmittedList] = useState([]);
  const [purchasedList, setPurchasedList] = useState([]);
  const [inboundList, setInboundList] = useState([]);
  const [exceptionList, setExceptionList] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [showModal, setShowModal] = useState(false);
  const [modalRecord, setModalRecord] = useState(null);
  const [modalAction, setModalAction] = useState("");
  const [modalForm, setModalForm] = useState({ poNumber: "", orderAmount: "", partialInboundQuantity: "", totalOrderAmount: "" });
  const [error, setError] = useState("");
  const [editingPoNumber, setEditingPoNumber] = useState(null);
  const [tempPoNumber, setTempPoNumber] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedRegion, setSelectedRegion] = useState([]);
  const [editingOrderAmount, setEditingOrderAmount] = useState(null);
  const [tempOrderAmount, setTempOrderAmount] = useState("");
  // 多选状态
  const [selectedRows, setSelectedRows] = useState([]);
  // 新增：记录是否已操作（避免默认重置）
  const hasOperatedRef = useRef(false);

  useEffect(() => {
    document.title = "鲲鹏内部系统v1";
    fetchAll();
    return () => {
      document.title = "Order System";
    };
  }, []);

  useEffect(() => {
    // 只在第一次进入（数据加载后且未操作过）时，默认设为“已提交”
    if (allList.length > 0 && !hasOperatedRef.current) {
      setSelectedStatus("已提交");
    }
  }, [allList]);

  const fetchAll = async () => {
    try {
      console.log("Fetching records...");
      const q = new AV.Query("PurchaseRequest");
      q.limit(1000);
      const res = await q.find();
      console.log("Raw LeanCloud response:", res);
      const list = res.map(item => {
        const json = item.toJSON();
        // 修改：将“已采购待确认”状态统一改为“已采购”
        let updatedStatus = json.status;
        if (updatedStatus === "已采购待确认") {
          updatedStatus = "已采购";
          // 更新数据库中的状态
          const record = AV.Object.createWithoutData("PurchaseRequest", item.id);
          record.set("status", updatedStatus);
          record.save().catch(err => console.error("更新状态失败:", err));
        }
        return {
          id: item.id,
          ...json,
          submittedAt: json.submittedAt || null,
          sku: json.sku || null,
          poNumber: json.poNumber || null,
          orderAmount: json.orderAmount || null,
          quantity: json.quantity || 0,
          status: updatedStatus,
          country: json.country || null,
          partialInboundQuantity: json.partialInboundQuantity || 0,
          remainingQuantity: json.quantity - (json.partialInboundQuantity || 0),
        };
      });
      console.log("Processed list:", list);
      setAllList(list);
      setSubmittedList(list.filter(item => item.status === "已提交"));
      setPurchasedList(list.filter(item => item.status?.startsWith("已采购")));
      setInboundList(list.filter(item => item.status === "已入库"));
      setExceptionList(list.filter(item => item.status === "异常"));
    } catch (err) {
      console.error("获取数据失败:", err);
      setError("加载数据失败：" + err.message);
    }
  };

  // 新增：计算每个状态的汇总（订单数、件数、金额）
  const computeSummary = (list) => {
    return {
      count: list.length,
      totalQuantity: list.reduce((sum, item) => sum + (item.quantity || 0), 0),
      totalAmount: list.reduce((sum, item) => sum + (item.orderAmount || 0), 0),
    };
  };

  // 原有：计算状态计数（用于按钮）
  const computeStatusCounts = (list) => {
    const counts = {};
    list.forEach(item => {
      const status = item.status || "未知";
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  };

  // 处理复选框变化
  const handleRowSelect = (id) => {
    setSelectedRows(prev =>
      prev.includes(id)
        ? prev.filter(s => s !== id)
        : [...prev, id]
    );
    hasOperatedRef.current = true; // 标记已操作
  };

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedRows.length === displayList.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(displayList.map(r => r.id));
    }
    hasOperatedRef.current = true; // 标记已操作
  };

  // 清空选中
  const clearSelection = () => {
    setSelectedRows([]);
  };

  const handleSearch = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    let filtered = allList;
    if (query) {
      filtered = filtered.filter(item =>
        item.sku?.toLowerCase().includes(query.toLowerCase()) ||
        item.country?.toLowerCase().includes(query.toLowerCase())
      );
    }
    setAllList(filtered);
    hasOperatedRef.current = true; // 标记已操作
  };

  const handleSort = () => {
    const newOrder = sortOrder === "desc" ? "asc" : "desc";
    setSortOrder(newOrder);
    const sorted = [...allList].sort((a, b) => {
      const aTime = new Date(a.submittedAt).getTime();
      const bTime = new Date(b.submittedAt).getTime();
      return newOrder === "asc" ? aTime - bTime : bTime - aTime;
    });
    setAllList(sorted);
    hasOperatedRef.current = true; // 标记已操作
  };

  const startEditingPo = (id, poNumber) => {
    setEditingPoNumber(id);
    setTempPoNumber(poNumber || "");
    hasOperatedRef.current = true; // 标记已操作
  };

  const handleSavePoNumber = async (id) => {
    const po = tempPoNumber.trim();
    if (!po) {
      alert("采购订单号不能为空");
      return;
    }
    try {
      const record = AV.Object.createWithoutData("PurchaseRequest", id);
      record.set("poNumber", po);
      await record.save();
      setAllList(prev =>
        prev.map(item =>
          item.id === id ? { ...item, poNumber: po } : item
        )
      );
      setSubmittedList(prev =>
        prev.map(item =>
          item.id === id ? { ...item, poNumber: po } : item
        )
      );
      setEditingPoNumber(null);
      hasOperatedRef.current = true; // 标记已操作
    } catch (err) {
      console.error("保存PO号失败:", err);
      alert("保存失败：" + err.message);
    }
  };

  const startEditingOrderAmount = (id, orderAmount) => {
    setEditingOrderAmount(id);
    setTempOrderAmount(orderAmount ? orderAmount.toString() : "");
    hasOperatedRef.current = true; // 标记已操作
  };

  const handleSaveOrderAmount = async (id) => {
    const amount = parseFloat(tempOrderAmount);
    if (isNaN(amount) || amount < 0) {
      alert("订单金额必须是非负数字");
      return;
    }
    try {
      const record = AV.Object.createWithoutData("PurchaseRequest", id);
      record.set("orderAmount", amount);
      await record.save();
      setAllList(prev =>
        prev.map(item =>
          item.id === id ? { ...item, orderAmount: amount } : item
        )
      );
      setSubmittedList(prev =>
        prev.map(item =>
          item.id === id ? { ...item, orderAmount: amount } : item
        )
      );
      setEditingOrderAmount(null);
      hasOperatedRef.current = true; // 标记已操作
    } catch (err) {
      console.error("保存订单金额失败:", err);
      alert("保存失败：" + err.message);
    }
  };

  const markStatus = async (id, status) => {
    try {
      const record = AV.Object.createWithoutData("PurchaseRequest", id);
      record.set("status", status);
      await record.save();
      fetchAll();
      hasOperatedRef.current = true; // 标记已操作
    } catch (err) {
      console.error("更新状态失败:", err);
      alert("操作失败：" + err.message);
    }
  };

  const handleModalChange = (e) => {
    const { name, value } = e.target;
    setModalForm(prev => ({ ...prev, [name]: value }));
    setError("");
    hasOperatedRef.current = true; // 标记已操作
  };

  const openModal = (record, action) => {
    setModalRecord(record);
    setModalAction(action);
    setModalForm({
      poNumber: record.poNumber || "",
      orderAmount: record.orderAmount ? record.orderAmount.toString() : "",
      partialInboundQuantity: record.partialInboundQuantity?.toString() || "",
      totalOrderAmount: "",
    });
    setError("");
    setShowModal(true);
    hasOperatedRef.current = true; // 标记已操作
  };

  // 打开批量输入模态
  const openBatchModal = () => {
    if (selectedRows.length === 0) {
      alert("请先选择要合并的行");
      return;
    }
    // 只处理“已提交”状态的行
    const validSelected = displayList.filter(r => selectedRows.includes(r.id) && r.status === "已提交");
    if (validSelected.length === 0) {
      alert("批量输入仅支持已提交状态的行");
      return;
    }
    setModalRecord(validSelected); // 数组
    setModalAction("batchInput");
    setModalForm({ poNumber: "", totalOrderAmount: "" });
    setError("");
    setShowModal(true);
    hasOperatedRef.current = true; // 标记已操作
  };

  const closeModal = () => {
    setShowModal(false);
    setModalRecord(null);
    setModalAction("");
    setModalForm({ poNumber: "", orderAmount: "", partialInboundQuantity: "", totalOrderAmount: "" });
    setError("");
  };

  const handleModalSave = async () => {
    const record = modalRecord;
    try {
      if (modalAction === "requirePoNumber") {
        // 单个输入PO和金额
        const poNumber = modalForm.poNumber.trim();
        const orderAmount = parseFloat(modalForm.orderAmount);
        if (!poNumber) {
          setError("采购订单号不能为空");
          return;
        }
        if (isNaN(orderAmount) || orderAmount < 0) {
          setError("采购金额必须是非负数字");
          return;
        }
        const PurchaseRequest = AV.Object.createWithoutData("PurchaseRequest", record.id);
        PurchaseRequest.set("poNumber", poNumber);
        PurchaseRequest.set("orderAmount", orderAmount);
        PurchaseRequest.set("status", "已采购");
        await PurchaseRequest.save();

        // 新增：自动扣除资金
        await deductFunds(record.country, poNumber, record.sku, orderAmount);

      } else if (modalAction === "partialInbound") {
        // 分批入库（单个）
        const partialQty = parseInt(modalForm.partialInboundQuantity);
        if (isNaN(partialQty) || partialQty <= 0) {
          setError("入库数量必须是正整数");
          return;
        }
        const currentPartial = record.partialInboundQuantity || 0;
        const totalInbound = currentPartial + partialQty;
        const PurchaseRequest = AV.Object.createWithoutData("PurchaseRequest", record.id);
        PurchaseRequest.set("partialInboundQuantity", totalInbound);
        let newStatus = record.status;
        if (totalInbound >= record.quantity) {
          newStatus = "已入库";
        } else {
          newStatus = `已采购剩余${record.quantity - totalInbound}`;
        }
        PurchaseRequest.set("status", newStatus);
        await PurchaseRequest.save();
        // 注意：入库不扣除资金（已在“已采购”时扣除）

      } else if (modalAction === "batchInput") {
        // 批量输入
        const poNumber = modalForm.poNumber.trim();
        const totalOrderAmount = parseFloat(modalForm.totalOrderAmount);
        if (!poNumber) {
          setError("采购订单号不能为空");
          return;
        }
        if (isNaN(totalOrderAmount) || totalOrderAmount < 0) {
          setError("总合同金额必须是非负数字");
          return;
        }
        // 正确累加总数量
        const totalQuantity = record.reduce((sum, r) => sum + r.quantity, 0);
        if (totalQuantity === 0) {
          setError("选中的行总数量为0，无法分摊");
          return;
        }
        // 检查站点是否一致（可选优化）
        const countries = [...new Set(record.map(r => r.country))];
        if (countries.length > 1) {
          console.warn("批量订单跨多个站点，按站点逐个扣除");
        }
        // 批量保存
        const savePromises = record.map(async (r) => {
          const PurchaseRequest = AV.Object.createWithoutData("PurchaseRequest", r.id);
          // 分摊金额：(当前行quantity / 总quantity) * 总金额
          const rowAmount = (r.quantity / totalQuantity) * totalOrderAmount;
          PurchaseRequest.set("poNumber", poNumber);
          PurchaseRequest.set("orderAmount", rowAmount);
          PurchaseRequest.set("status", "已采购");
          await PurchaseRequest.save();

          // 新增：自动扣除资金（逐个订单）
          await deductFunds(r.country, poNumber, r.sku, rowAmount);
        });
        await Promise.all(savePromises);
        clearSelection(); // 保存后清空选中
      }

      alert("操作成功");
      closeModal();
      fetchAll();
      hasOperatedRef.current = true; // 标记已操作
    } catch (err) {
      console.error("保存失败:", err);
      setError("保存失败：" + err.message);
    }
  };

  // 各状态汇总
  const allSummary = computeSummary(allList);
  const submittedSummary = computeSummary(submittedList);
  const purchasedSummary = computeSummary(purchasedList);
  const inboundSummary = computeSummary(inboundList);

  // 新增：最近30天订单汇总
  const recent30DaysList = allList.filter(item => {
    if (!item.submittedAt) return false;
    const submittedDate = new Date(item.submittedAt);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return submittedDate >= thirtyDaysAgo;
  });
  const recent30DaysSummary = computeSummary(recent30DaysList);

  const statusCounts = computeStatusCounts(allList); // 现在安全调用
  const totalCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const filteredList = selectedStatus
    ? allList.filter(item => item.status === selectedStatus)
    : allList;

  const regionFilteredList = selectedRegion.length
    ? filteredList.filter(item => selectedRegion.includes(item.country))
    : filteredList;

  const displayList = regionFilteredList;

  const handleStatusFilter = (status) => {
    setSelectedStatus(status === selectedStatus ? "" : status);
    clearSelection();
    hasOperatedRef.current = true; // 标记已操作
  };

  const handleRegionFilter = (region) => {
    if (selectedRegion.includes(region)) {
      setSelectedRegion(prev => prev.filter(r => r !== region));
    } else {
      setSelectedRegion(prev => [...prev, region]);
    }
    clearSelection();
    hasOperatedRef.current = true; // 标记已操作
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold text-blue-800 mb-6">采购管理</h1>

      {/* 优化后的统计卡片：每个显示订单数 + 件数 + 金额 */ }
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        {/* 总记录卡片 */ }
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-600 mb-2">总记录</h3>
          <p className="text-lg font-bold text-blue-600 mb-1">订单数: {allSummary.count}</p>
          <p className="text-sm text-gray-700 mb-1">件数: {allSummary.totalQuantity}</p>
          <p className="text-sm text-gray-700">金额: ¥{allSummary.totalAmount ? allSummary.totalAmount.toFixed(2) : '-'}</p>
        </div>
        {/* 待采购卡片 */ }
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-600 mb-2">待采购</h3>
          <p className="text-lg font-bold text-yellow-600 mb-1">订单数: {submittedSummary.count}</p>
          <p className="text-sm text-gray-700 mb-1">件数: {submittedSummary.totalQuantity}</p>
          <p className="text-sm text-gray-700">金额: ¥{submittedSummary.totalAmount ? submittedSummary.totalAmount.toFixed(2) : '-'}</p>
        </div>
        {/* 已采购卡片 */ }
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-600 mb-2">已采购</h3>
          <p className="text-lg font-bold text-blue-600 mb-1">订单数: {purchasedSummary.count}</p>
          <p className="text-sm text-gray-700 mb-1">件数: {purchasedSummary.totalQuantity}</p>
          <p className="text-sm text-gray-700">金额: ¥{purchasedSummary.totalAmount ? purchasedSummary.totalAmount.toFixed(2) : '-'}</p>
        </div>
        {/* 已入库卡片 */ }
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-600 mb-2">已入库</h3>
          <p className="text-lg font-bold text-green-600 mb-1">订单数: {inboundSummary.count}</p>
          <p className="text-sm text-gray-700 mb-1">件数: {inboundSummary.totalQuantity}</p>
          <p className="text-sm text-gray-700">金额: ¥{inboundSummary.totalAmount ? inboundSummary.totalAmount.toFixed(2) : '-'}</p>
        </div>
        {/* 新增：最近30天订单卡片 */ }
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-600 mb-2">最近30天订单</h3>
          <p className="text-lg font-bold text-orange-600 mb-1">订单数: {recent30DaysSummary.count}</p>
          <p className="text-sm text-gray-700 mb-1">件数: {recent30DaysSummary.totalQuantity}</p>
          <p className="text-sm text-gray-700">金额: ¥{recent30DaysSummary.totalAmount ? recent30DaysSummary.totalAmount.toFixed(2) : '-'}</p>
        </div>
      </div>

      {/* 筛选和搜索 */ }
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <input
            type="text"
            placeholder="搜索 SKU 或国家..."
            value={searchQuery}
            onChange={handleSearch}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSort}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              {sortOrder === "desc" ? "最新" : "最早"}
            </button>
            {/* 合并输入按钮 */ }
            <button
              onClick={openBatchModal}
              disabled={selectedStatus !== "已提交" || selectedRows.length === 0}
              className={`
                px-4 py-2 rounded-md text-sm transition-colors ${
                  selectedStatus !== "已提交" || selectedRows.length === 0
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-purple-600 text-white hover:bg-purple-700"
                }`}
            >
              合并输入 ({selectedRows.length})
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {["已提交", "已采购", "已入库", "异常"].map(status => (
            <button
              key={status}
              onClick={() => handleStatusFilter(status)}
              className={`
                px-3 py-1 rounded-full text-xs ${
                  selectedStatus === status
                    ? "bg-blue-100 text-blue-800"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
            >
              {status} ({statusCounts[status] || 0})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {["美国", "德国", "加拿大", "英国", "澳洲", "其他"].map(region => (
            <button
              key={region}
              onClick={() => handleRegionFilter(region)}
              className={`
                px-3 py-1 rounded-full text-xs ${
                  selectedRegion.includes(region)
                    ? "bg-purple-100 text-purple-800"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
            >
              {region}
            </button>
          ))}
        </div>
      </div>

      {/* 数据表格（保持不变） */ }
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {/* 复选框列 */ }
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <input
                    type="checkbox"
                    checked={selectedRows.length === displayList.length && displayList.length > 0}
                    onChange={handleSelectAll}
                    disabled={selectedStatus !== "已提交"}
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">数量</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">国家</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PO号</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">已入库数量</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单金额</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayList.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center text-gray-500">
                    {searchQuery || selectedStatus || selectedRegion.length > 0
                      ? "没有匹配的记录"
                      : "暂无数据"}
                  </td>
                </tr>
              ) : (
                displayList.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    {/* 复选框 */ }
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {selectedStatus === "已提交" && (
                        <input
                          type="checkbox"
                          checked={selectedRows.includes(r.id)}
                          onChange={() => handleRowSelect(r.id)}
                        />
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {r.sku}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {r.quantity}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <CountryBadge country={r.country} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={r.status} />
                      {r.status?.startsWith("已采购剩余") && (
                        <span className="ml-2 text-sm text-gray-600">
                          剩余 {r.remainingQuantity}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {editingPoNumber === r.id ? (
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={tempPoNumber}
                            onChange={(e) => setTempPoNumber(e.target.value)}
                            onBlur={() => handleSavePoNumber(r.id)}
                            onKeyDown={(e) => e.key === "Enter" && handleSavePoNumber(r.id)}
                            className="w-32 px-2 py-1 border rounded text-xs"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSavePoNumber(r.id)}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                          >
                            保存
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => startEditingPo(r.id, r.poNumber)}
                          className={`
                            cursor-pointer hover:underline ${
                              r.poNumber ? "text-blue-600" : "text-gray-500"
                            }`}
                        >
                          {r.poNumber || "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {r.partialInboundQuantity || 0}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {editingOrderAmount === r.id ? (
                        <div className="flex items-center space-x-2">
                          <input
                            type="number"
                            step="0.01"
                            value={tempOrderAmount}
                            onChange={(e) => setTempOrderAmount(e.target.value)}
                            onBlur={() => handleSaveOrderAmount(r.id)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveOrderAmount(r.id)}
                            className="w-24 px-2 py-1 border rounded text-xs"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveOrderAmount(r.id)}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                          >
                            保存
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => startEditingOrderAmount(r.id, r.orderAmount)}
                          className={`
                            cursor-pointer hover:underline ${
                              r.orderAmount ? "text-blue-600" : "text-gray-500"
                            }`}
                        >
                          {r.orderAmount ? r.orderAmount.toFixed(2) : "-"}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      {r.status === "已提交" && (
                        <button
                          onClick={() => openModal(r, "requirePoNumber")}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          输入PO号
                        </button>
                      )}
                      {r.status?.startsWith("已采购") && !r.status.startsWith("已采购剩余") && (
                        <button
                          onClick={() => openModal(r, "partialInbound")}
                          className="text-green-600 hover:text-green-900"
                        >
                          分批入库
                        </button>
                      )}
                      {r.status?.startsWith("已采购剩余") && (
                        <button
                          onClick={() => openModal(r, "partialInbound")}
                          className="text-green-600 hover:text-green-900"
                        >
                          继续入库
                        </button>
                      )}
                      {["已提交", "已采购", "已采购剩余"].includes(r.status) && (
                        <button
                          onClick={() => markStatus(r.id, "异常")}
                          className="text-red-600 hover:text-red-900"
                        >
                          标记异常
                        </button>
                      )}
                      {r.status !== "已终止" && (
                        <button
                          onClick={() => markStatus(r.id, "已终止")}
                          className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"
                        >
                          结束采购
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && !allList.length && (
        <p className="text-red-600 text-sm mt-4">{error}</p>
      )}

      {/* 原有模态框（保持不变） */ }
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl"
            >
              ×
            </button>
            <h3 className="text-2xl font-semibold text-blue-800 mb-6">
              {modalAction === "requirePoNumber" ? "请输入采购订单号" : modalAction === "partialInbound" ? "分批入库" : "合并输入"}
            </h3>
            <div className="space-y-4 text-sm">
              {modalAction === "batchInput" ? (
                <>
                  {/* 批量模态：显示选中SKU列表 + 总数量 + 分摊预览 */ }
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">选中的SKU（总数量: {modalRecord.reduce((sum, r) => sum + r.quantity, 0)}）</label>
                    <div className="border rounded-md p-2 max-h-32 overflow-y-auto bg-gray-50">
                      {modalRecord.map((r, idx) => (
                        <div key={idx} className="text-xs text-gray-600 mb-1">
                          {r.sku} (数量: {r.quantity})
                        </div>
                      ))}
                    </div>
                    {modalForm.totalOrderAmount && (
                      <div className="text-xs text-gray-500 mt-1">
                        分摊预览：每个SKU金额 = (其数量 / 总数量) × {modalForm.totalOrderAmount}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">采购订单号（必填）</label>
                    <input
                      name="poNumber"
                      value={modalForm.poNumber}
                      onChange={handleModalChange}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                      placeholder="请输入采购订单号"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">总合同金额(RMB)（必填）</label>
                    <input
                      name="totalOrderAmount"
                      type="number"
                      step="0.01"
                      value={modalForm.totalOrderAmount}
                      onChange={handleModalChange}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                      placeholder="请输入总合同金额"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">SKU</label>
                    <input
                      value={Array.isArray(modalRecord) ? modalRecord.map(r => r.sku).join(', ') : modalRecord?.sku || "-"}
                      readOnly
                      className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                    />
                  </div>
                  {modalAction === "requirePoNumber" && (
                    <>
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">采购订单号（必填）</label>
                        <input
                          name="poNumber"
                          value={modalForm.poNumber}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                          placeholder="请输入采购订单号"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">采购金额(RMB)（必填）</label>
                        <input
                          name="orderAmount"
                          type="number"
                          step="0.01"
                          value={modalForm.orderAmount}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                          placeholder="请输入采购金额"
                        />
                      </div>
                    </>
                  )}
                  {modalAction === "partialInbound" && (
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">本次入库数量</label>
                      <input
                        name="partialInboundQuantity"
                        type="number"
                        value={modalForm.partialInboundQuantity}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                        placeholder="0"
                      />
                    </div>
                  )}
                </>
              )}
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleModalSave}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
