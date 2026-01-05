import { useEffect, useState } from "react";
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
  const [modalForm, setModalForm] = useState({ poNumber: "", partialInboundQuantity: "" });
  const [error, setError] = useState("");
  const [editingPoNumber, setEditingPoNumber] = useState(null);
  const [tempPoNumber, setTempPoNumber] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedRegion, setSelectedRegion] = useState([]);

  useEffect(() => {
    document.title = "鲲鹏内部系统v1";
    fetchAll();
    return () => {
      document.title = "Order System";
    };
  }, []);

  const fetchAll = async () => {
    try {
      console.log("Fetching records...");
      const q = new AV.Query("PurchaseRequest");
      q.limit(1000);
      const res = await q.find();
      console.log("Raw LeanCloud response:", res);
      const list = res.map(item => {
        const json = item.toJSON();
        return {
          id: item.id,
          ...json,
          submittedAt: json.submittedAt || null,
          sku: json.sku || null,
          poNumber: json.poNumber || null,
          quantity: json.quantity || 0,
          status: json.status || null,
          country: json.country || null,
          partialInboundQuantity: json.partialInboundQuantity || 0,
        };
      });
      console.log("Processed records:", list.map(r => ({
        id: r.id,
        sku: r.sku,
        status: r.status,
        submittedAt: r.submittedAt,
        quantity: r.quantity,
        poNumber: r.poNumber,
      })));

      if (list.length === 0) {
        console.warn("No PurchaseRequest found");
        setError("No purchase records found in the database. Check LeanCloud configuration.");
      }

      const statuses = [...new Set(list.map(r => r.status || "未定义"))];
      console.log("Unique statuses:", statuses);

      setAllList(list);
      setSubmittedList(list.filter(r => r.status === "已提交"));
      setPurchasedList(list.filter(r => r.status === "已采购"));
      setInboundList(list.filter(r => r.status === "已入库"));
      setExceptionList(list.filter(r => r.status === "异常"));
    } catch (err) {
      console.error("Fetch error:", err);
      setError(`Failed to retrieve records: ${err.message || "unknown error"}`);
    }
  };

  const updateField = async (id, field, value) => {
    try {
      const obj = AV.Object.createWithoutData("PurchaseRequest", id);
      obj.set(field, value);
      await obj.save();
      console.log(`Updated ${field} for record ${id}`);
      fetchAll();
    } catch (err) {
      setError(`Update failed: ${err.message || "unknown error"}`);
    }
  };

  const markStatus = async (id, status, poNumber = null) => {
    const allowed = ["异常", "待提交", "已终止", "已采购"];
    if (!allowed.includes(status)) return;

    if (status === "已采购" && !poNumber) {
      const record = allList.find(r => r.id === id);
      setModalRecord(record);
      setModalAction("requirePoNumber");
      setModalForm({ poNumber: "", partialInboundQuantity: "" });
      setShowModal(true);
      setError("");
      return;
    }

    if (!window.confirm(`确定将该记录标记为【${status}】？`)) return;

    try {
      const obj = AV.Object.createWithoutData("PurchaseRequest", id);
      await obj.fetch();
      obj.set("status", status);
      if (poNumber) obj.set("poNumber", poNumber);

      if (status === "异常") obj.set("exceptionAt", new Date());
      if (status === "已终止") obj.set("terminatedAt", new Date());
      if (status === "已采购") {
        const user = JSON.parse(localStorage.getItem("user") || "{}");
        obj.set("purchasedBy", user.username || "未知");
        obj.set("purchasedAt", new Date());
      }

      await obj.save();
      fetchAll();
    } catch (err) {
      setError(`状态更新失败: ${err.message || "未知错误"}`);
    }
  };

  const revertToPending = async (id) => {
    if (!window.confirm(`确定将该记录打回修改（状态变更为【待提交】）？`)) return;
    try {
      const obj = AV.Object.createWithoutData("PurchaseRequest", id);
      await obj.fetch();
      obj.set("status", "待提交");
      await obj.save();
      console.log(`Reverted record ${id} to 待提交`);
      fetchAll();
    } catch (err) {
      setError(`打回修改失败: ${err.message || "未知错误"}`);
    }
  };

  const partialInbound = async (record, quantity) => {
    const current = parseInt(quantity);
    if (isNaN(current) || current <= 0) {
      setError("请输入有效的数字！");
      return;
    }
    try {
      const req = AV.Object.createWithoutData("PurchaseRequest", record.id);
      await req.fetch();
      const prev = req.get("partialInboundQuantity") || 0;
      const total = prev + current;
      req.set("partialInboundQuantity", total);
      if (total >= (record.quantity || 0)) req.set("status", "已入库");
      await req.save();

      const q2 = new AV.Query("StockItem");
      q2.equalTo("sku", record.sku);
      const stock = await q2.first();
      if (stock) {
        stock.increment("quantity", current);
        stock.set("lastInboundAt", new Date());
        await stock.save();
      } else {
        const StockItem = AV.Object.extend("StockItem");
        const s = new StockItem();
        s.set("sku", record.sku || "未知");
        s.set("quantity", current);
        s.set("lastInboundAt", new Date());
        await s.save();
      }

      fetchAll();
      closeModal();
    } catch (err) {
      setError(`分批入库失败: ${err.message || "未知错误"}`);
    }
  };

  const confirmInbound = async (record) => {
    try {
      const prev = record.partialInboundQuantity || 0;
      const remaining = Math.max(0, (record.quantity || 0) - prev);
      if (remaining <= 0) {
        setError("没有剩余数量可入库");
        return;
      }
      const req = AV.Object.createWithoutData("PurchaseRequest", record.id);
      await req.fetch();
      req.set("partialInboundQuantity", record.quantity || 0);
      req.set("status", "已入库");
      await req.save();

      const q2 = new AV.Query("StockItem");
      q2.equalTo("sku", record.sku);
      const stock = await q2.first();
      if (stock) {
        stock.increment("quantity", remaining);
        stock.set("lastInboundAt", new Date());
        await stock.save();
      } else {
        const StockItem = AV.Object.extend("StockItem");
        const s = new StockItem();
        s.set("sku", record.sku || "未知");
        s.set("quantity", remaining);
        s.set("lastInboundAt", new Date());
        await s.save();
      }

      fetchAll();
    } catch (err) {
      setError(`全部入库失败: ${err.message || "未知错误"}`);
    }
  };

  const getDaysSince = dateStr => {
    if (!dateStr) return "-";
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const formatDate = dateStr => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  const openModal = (record, action) => {
    setModalRecord(record);
    setModalAction(action);
    setModalForm({
      poNumber: action === "requirePoNumber" ? "" : record.poNumber || "",
      partialInboundQuantity: action === "partialInbound" ? "" : "",
    });
    setShowModal(true);
    setError("");
  };

  const closeModal = () => {
    setShowModal(false);
    setModalRecord(null);
    setModalAction("");
    setModalForm({ poNumber: "", partialInboundQuantity: "" });
    setError("");
  };

  const handleModalSave = async () => {
    if (modalAction === "requirePoNumber") {
      if (!modalForm.poNumber.trim()) {
        setError("采购订单号为必填项！");
        return;
      }
      await markStatus(modalRecord.id, "已采购", modalForm.poNumber);
      closeModal();
    } else if (modalAction === "partialInbound") {
      await partialInbound(modalRecord, modalForm.partialInboundQuantity);
    }
  };

  const handleModalChange = e => {
    const { name, value } = e.target;
    setModalForm(prev => ({ ...prev, [name]: value }));
    setError("");
  };

  const startEditingPoNumber = record => {
    console.log("Starting to edit PO number for record:", record.id, "Current PO:", record.poNumber);
    setEditingPoNumber(record.id);
    setTempPoNumber(record.poNumber || "");
  };

  const savePoNumber = async id => {
    const record = allList.find(r => r.id === id);
    const newPoNumber = tempPoNumber.trim() || null;
    if (newPoNumber !== (record.poNumber || null)) {
      console.log(`Saving PO number ${newPoNumber} for record ${id}`);
      await updateField(id, "poNumber", newPoNumber);
    } else {
      console.log("No changes to PO number, skipping save");
    }
    setEditingPoNumber(null);
    setTempPoNumber("");
  };

  const handlePoNumberChange = e => {
    setTempPoNumber(e.target.value);
  };

  const handlePoNumberKeyDown = (e, id) => {
    if (e.key === "Enter") {
      savePoNumber(id);
    } else if (e.key === "Escape") {
      console.log("Cancelling PO number edit");
      setEditingPoNumber(null);
      setTempPoNumber("");
    }
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => (prev === "desc" ? "asc" : "desc"));
  };

  const exportToCSV = () => {
    const headers = [
      "SKU",
      "采购订单号",
      "国家",
      "数量",
      "状态",
      "提交时间",
      "采购日期",
      "异常日期",
      "终止时间",
      "已入库数量",
    ];
    const rows = filteredAll.map(r => [
      r.sku || "-",
      r.poNumber || "-",
      r.country || "-",
      r.quantity || "",
      r.status || "-",
      formatDate(r.submittedAt),
      formatDate(r.purchasedAt),
      formatDate(r.exceptionAt),
      formatDate(r.terminatedAt),
      r.partialInboundQuantity || "",
    ]);

    const csvContent = [
      headers.map(h => `"${h}"`).join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(",")),
    ].join("\n");

    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `purchase_export_${today}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const filterRecords = (records) => {
    return records.filter((r) => {
      const matchesSearch = [r.sku || "", r.poNumber || ""].some((field) =>
        field.toLowerCase().includes(searchQuery.toLowerCase())
      );
      const matchesStatus = !selectedStatus || r.status === selectedStatus;
      const matchesRegion = !selectedRegion.length
        ? true
        : selectedRegion.includes(r.country);
      return matchesSearch && matchesStatus && matchesRegion;
    });
  };

  const sortRecords = (records) => {
    return [...records].sort((a, b) => {
      const dateA = new Date(a.submittedAt).getTime();
      const dateB = new Date(b.submittedAt).getTime();
      return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });
  };

  const filteredAll = filterRecords(sortRecords(allList));
  const submittedTotal = submittedList.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const purchasedTotal = purchasedList.reduce((sum, r) => sum + (r.quantity || 0), 0);
  const inboundTotal = inboundList.reduce((sum, r) => sum + (r.quantity || 0), 0);

  const regions = [
    {
      name: "美国",
      key: ["美国"],
      color: "bg-blue-100 text-blue-800 border-blue-300",
    },
    {
      name: "德国+澳洲",
      key: ["德国", "澳洲"],
      color: "bg-gray-100 text-gray-700 border-gray-300",
    },
    {
      name: "英国",
      key: ["英国"],
      color: "bg-purple-100 text-purple-800 border-purple-300",
    },
    {
      name: "加拿大",
      key: ["加拿大"],
      color: "bg-red-100 text-red-800 border-red-300",
    },
  ];

  const regionStats = regions.map((region) => {
    const regionRecords = allList.filter((r) =>
      region.key.includes(r.country)
    );
    return {
      name: region.name,
      color: region.color,
      submitted: regionRecords
        .filter((r) => r.status === "已提交")
        .reduce((sum, r) => sum + (r.quantity || 0), 0),
      purchased: regionRecords
        .filter((r) => r.status === "已采购")
        .reduce((sum, r) => sum + (r.quantity || 0), 0),
      inbound: regionRecords
        .filter((r) => r.status === "已入库")
        .reduce((sum, r) => sum + (r.quantity || 0), 0),
      key: region.key,
    };
  });

  const clearFilters = () => {
    setSelectedStatus("");
    setSelectedRegion([]);
    setSearchQuery("");
  };

  return (
    <div className="p-6 min-h-screen bg-gray-100">
      <h1 className="text-3xl font-bold text-blue-800 mb-8 border-b pb-2">📦 采购管理</h1>
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4">
            <input
              type="text"
              placeholder="搜索 SKU 或 采购订单号"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={toggleSortOrder}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              按提交时间排序 ({sortOrder === "desc" ? "新到旧" : "旧到新"})
            </button>
            <button
              onClick={clearFilters}
              className="px-4 py-2 bg-red-500 text-white rounded-md text-sm hover:bg-red-600"
            >
              清除筛选
            </button>
          </div>
          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
          >
            导出 CSV
          </button>
        </div>

        <div className="flex flex-nowrap gap-6 mb-6 overflow-x-auto">
          {/* Dashboard Blocks Container */}
          <div className="border border-gray-300 rounded-md p-2 flex gap-3">
            <button
              onClick={() => setSelectedStatus("已提交")}
              className={`flex-shrink-0 p-2 rounded-md bg-yellow-100 text-yellow-800 border border-yellow-300 shadow-sm cursor-pointer hover:bg-yellow-200 transition-colors w-24 text-center ${selectedStatus === "已提交" ? 'ring-2 ring-yellow-500' : ''}`}
            >
              <h4 className="text-sm font-semibold mb-1">待处理</h4>
              <p className="text-lg font-bold">{submittedTotal}</p>
            </button>
            <button
              onClick={() => setSelectedStatus("已采购")}
              className={`flex-shrink-0 p-2 rounded-md bg-blue-100 text-blue-800 border border-blue-300 shadow-sm cursor-pointer hover:bg-blue-200 transition-colors w-24 text-center ${selectedStatus === "已采购" ? 'ring-2 ring-blue-500' : ''}`}
            >
              <h4 className="text-sm font-semibold mb-1">进行中</h4>
              <p className="text-lg font-bold">{purchasedTotal}</p>
            </button>
            <button
              onClick={() => setSelectedStatus("已入库")}
              className={`flex-shrink-0 p-2 rounded-md bg-green-100 text-green-800 border border-green-300 shadow-sm cursor-pointer hover:bg-green-200 transition-colors w-24 text-center ${selectedStatus === "已入库" ? 'ring-2 ring-green-500' : ''}`}
            >
              <h4 className="text-sm font-semibold mb-1">已入库</h4>
              <p className="text-lg font-bold">{inboundTotal}</p>
            </button>
          </div>
          {/* Region Blocks Container */}
          <div className="border border-gray-300 rounded-md p-2 flex gap-3">
            {regionStats.map((stat) => (
              <button
                key={stat.name}
                onClick={() => setSelectedRegion(stat.key)}
                className={`flex-shrink-0 p-2 rounded-md ${stat.color} shadow-sm cursor-pointer hover:bg-opacity-80 transition-colors w-24 text-center ${selectedRegion.join(',') === stat.key.join(',') ? 'ring-2 ring-gray-500' : ''}`}
              >
                <h4 className="text-sm font-semibold mb-1">{stat.name}</h4>
                <p className="text-lg font-bold">{stat.submitted}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold text-blue-800 mb-3 border-b pb-1">📋 采购管理列表</h2>
          <div className="overflow-x-auto">
            <table className="w-full border rounded-md text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 border-b">SKU</th>
                  <th className="px-4 py-2 border-b">采购订单号（点击修改）</th>
                  <th className="px-4 py-2 border-b">国家</th>
                  <th className="px-4 py-2 border-b">数量</th>
                  <th className="px-4 py-2 border-b">已入库</th>
                  <th className="px-4 py-2 border-b">剩余</th>
                  <th className="px-4 py-2 border-b">状态</th>
                  <th className="px-4 py-2 border-b">提交时间</th>
                  <th className="px-4 py-2 border-b">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAll.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="text-center py-4 text-gray-500">
                      {searchQuery || selectedStatus || selectedRegion.length > 0
                        ? "无匹配记录"
                        : error || "暂无采购记录，请检查数据或添加记录"}
                    </td>
                  </tr>
                ) : (
                  filteredAll.map((r) => {
                    const prev = r.partialInboundQuantity || 0;
                    const remaining = Math.max(0, (r.quantity || 0) - prev);
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 border-b">{r.sku || '-'}</td>
                        <td className="px-4 py-2 border-b">
                          {editingPoNumber === r.id ? (
                            <input
                              type="text"
                              value={tempPoNumber}
                              onChange={handlePoNumberChange}
                              onBlur={() => savePoNumber(r.id)}
                              onKeyDown={(e) => handlePoNumberKeyDown(e, r.id)}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                          ) : (
                            <span
                              className="cursor-pointer text-blue-600 hover:underline"
                              onClick={() => startEditingPoNumber(r)}
                            >
                              {r.poNumber || '-'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 border-b">
                          <CountryBadge country={r.country} />
                        </td>
                        <td className="px-4 py-2 border-b">{r.quantity || 0}</td>
                        <td className="px-4 py-2 border-b">{prev}</td>
                        <td className="px-4 py-2 border-b">{remaining}</td>
                        <td className="px-4 py-2 border-b">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-2 border-b">{formatDate(r.submittedAt)}</td>
                        <td className="px-4 py-2 border-b">
                          <div className="flex gap-2">
                            {r.status === "已提交" ? (
                              <>
                                <button
                                  onClick={() => markStatus(r.id, "已采购", r.poNumber)}
                                  className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                                >
                                  确认采购
                                </button>
                                <button
                                  onClick={() => revertToPending(r.id)}
                                  className="px-2 py-1 bg-yellow-500 text-white rounded text-xs hover:bg-yellow-600"
                                >
                                  打回修改
                                </button>
                                <button
                                  onClick={() => markStatus(r.id, "异常")}
                                  className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                                >
                                  异常
                                </button>
                                <button
                                  onClick={() => markStatus(r.id, "已终止")}
                                  className="px-2 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-700"
                                >
                                  结束采购
                                </button>
                              </>
                            ) : r.status === "已采购" ? (
                              <>
                                <button
                                  onClick={() => confirmInbound(r)}
                                  className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                >
                                  全部入库
                                </button>
                                <button
                                  onClick={() => openModal(r, "partialInbound")}
                                  className="px-2 py-1 bg-yellow-500 text-white rounded text-xs hover:bg-yellow-600"
                                >
                                  分批入库
                                </button>
                                <button
                                  onClick={() => markStatus(r.id, "异常")}
                                  className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                                >
                                  异常
                                </button>
                                <button
                                  onClick={() => markStatus(r.id, "已终止")}
                                  className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"
                                >
                                  结束采购
                                </button>
                              </>
                            ) : r.status === "异常" ? (
                              <button
                                onClick={() => markStatus(r.id, "已终止")}
                                className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"
                              >
                                结束采购
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {error && !allList.length && (
          <p className="text-red-600 text-sm mt-4">{error}</p>
        )}
      </div>

      {showModal && modalRecord && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl"
            >
              ×
            </button>
            <h3 className="text-2xl font-semibold text-blue-800 mb-6">
              {modalAction === "requirePoNumber" ? "请输入采购订单号" : "分批入库"}
            </h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block font-medium text-gray-700 mb-1">SKU</label>
                <input
                  value={modalRecord.sku || "-"}
                  readOnly
                  className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                />
              </div>
              {modalAction === "requirePoNumber" && (
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
