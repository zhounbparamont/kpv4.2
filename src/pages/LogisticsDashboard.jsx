import React, { useEffect, useState } from "react";
import AV from "../leancloud";

// File icon helper
const getFileIcon = (filename) => {
  if (!filename) return "📁";
  const ext = filename.split(".").pop().toLowerCase();
  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["jpg", "jpeg", "png", "gif", "bmp"].includes(ext)) return "🖼️";
  return "📁";
};

// Date formatting helper
const formatDate = (dateValue) => {
  if (!dateValue) return "-";
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

// Calculate transit days
const calculateTransitDays = (record, currentDate) => {
  const submittedAt = new Date(record.submittedAt);
  const endDate = record.isArrived && record.arrivedAt ? new Date(record.arrivedAt) : currentDate;
  const days = Math.floor((endDate - submittedAt) / (1000 * 60 * 60 * 24));
  return {
    days: days >= 0 ? days : 0,
    icon: record.isArrived ? "🏭" : "🚢",
  };
};

// Section component
function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-blue-800 mb-3 border-b pb-1">{title}</h2>
      {children || <p className="text-sm text-gray-400 italic">暂无内容</p>}
    </div>
  );
}

// Info badges component
function InfoBadges({ record, forCSV = false }) {
  const isOperationIncomplete =
    !record.operationCartonCount || !record.operationVolume || !record.operationGrossWeight;
  const isForwarderIncomplete =
    !record.forwarderCartonCount ||
    !record.forwarderVolume ||
    !record.forwarderGrossWeight ||
    !record.transportMode ||
    !record.forwarder ||
    !record.channel ||
    !record.quote;
  if (forCSV) {
    const badges = [];
    if (isOperationIncomplete) badges.push("运营信息缺失");
    if (isForwarderIncomplete) badges.push("货代信息缺失");
    return badges.length ? badges.join(", ") : "-";
  }
  const badges = [];
  if (isOperationIncomplete) {
    badges.push({ icon: "⚠️", color: "bg-red-100 text-red-800", text: "运营信息缺失" });
  }
  if (isForwarderIncomplete) {
    badges.push({ icon: "📦", color: "bg-orange-100 text-orange-800", text: "货代信息缺失" });
  }
  return (
    <div className="flex flex-wrap gap-1">
      {badges.length ? (
        badges.map((badge, idx) => (
          <span
            key={idx}
            className={`px-2 py-0.5 text-xs rounded-full flex items-center justify-center ${badge.color}`}
            title={badge.text}
          >
            {badge.icon}
          </span>
        ))
      ) : (
        <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full" title="信息完整">
          ✅
        </span>
      )}
    </div>
  );
}

// Dashboard component for statistics
function StatsDashboard({ records, setSelectedCountry, setSelectedRegionKeys }) {
  const regions = [
    { name: "美国", key: ["US", "United States", "美国"], color: "bg-blue-100 text-blue-800 border-blue-300" },
    { name: "德国+澳洲", key: ["DE", "Germany", "德国", "AU", "Australia", "澳洲"], color: "bg-green-100 text-green-800 border-green-300" },
    { name: "英国", key: ["UK", "United Kingdom", "英国"], color: "bg-purple-100 text-purple-800 border-purple-300" },
    { name: "加拿大", key: ["CA", "Canada", "加拿大"], color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  ];
  const stats = regions.map((region) => {
    const regionRecords = records.filter((r) =>
      Array.isArray(region.key)
        ? region.key.includes(r.country)
        : r.country === region.key
    );
    const arrived = regionRecords.filter((r) => r.isArrived === true);
    const stat = {
      name: region.name,
      color: region.color,
      totalQuantity: regionRecords.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
      totalVolume: regionRecords.reduce((sum, r) => sum + (Number(r.operationVolume) || 0), 0),
      arrivedQuantity: arrived.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
      arrivedVolume: arrived.reduce((sum, r) => sum + (Number(r.operationVolume) || 0), 0),
    };
    return { ...stat, key: region.key };
  });
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      {stats.map((stat) => (
        <button
          key={stat.name}
          onClick={() => {
            if (stat.name === "德国+澳洲") {
              setSelectedCountry("");
              setSelectedRegionKeys(["德国", "澳洲"]);
            } else {
              setSelectedCountry(stat.key.find(k => ["美国", "英国", "加拿大"].includes(k)) || stat.key[0]);
              setSelectedRegionKeys([]);
            }
          }}
          className={`p-4 rounded-lg border ${stat.color} shadow-sm hover:bg-opacity-80 transition-colors cursor-pointer`}
          title={`点击筛选 ${stat.name} 的订单`}
        >
          <h3 className="text-lg font-semibold mb-2">{stat.name}</h3>
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium">总数量</p>
              <p className="text-2xl font-bold">{stat.totalQuantity}</p>
            </div>
            <div>
              <p className="text-sm font-medium">总体积</p>
              <p className="text-2xl font-bold">{stat.totalVolume.toFixed(2)} m³</p>
            </div>
            <div>
              <p className="text-sm font-medium">到货统计</p>
              <p className="text-sm">
                数量: {stat.arrivedQuantity} | 立方数: {stat.arrivedVolume.toFixed(2)} m³
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// Pagination component
function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pageNumbers = [];
  for (let i = 1; i <= totalPages; i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="flex justify-center items-center space-x-2 mt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        上一页
      </button>
      {pageNumbers.map((page) => (
        <button
          key={page}
          onClick={() => onPageChange(page)}
          className={`px-3 py-1 rounded ${
            currentPage === page
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          {page}
        </button>
      ))}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        下一页
      </button>
      <span className="text-sm text-gray-600">
        第 {currentPage} 页 / 共 {totalPages} 页
      </span>
    </div>
  );
}

export default function LogisticsDashboard() {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [modalRecord, setModalRecord] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [isCustomForwarder, setIsCustomForwarder] = useState(false);
  const [modalForm, setModalForm] = useState({
    operationCartonCount: "",
    forwarderCartonCount: "",
    operationVolume: "",
    forwarderVolume: "",
    operationGrossWeight: "",
    forwarderGrossWeight: "",
    transportMode: "",
    forwarder: "",
    channel: "",
    quote: "",
    etd: "",
    eta: "",
    appointmentNo: "",
    exportInvoiceNo: "",
    remarks: "",
    files: [],
  });
  const [sortOrder, setSortOrder] = useState("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [skuSearchQuery, setSkuSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedRegionKeys, setSelectedRegionKeys] = useState([]);
  const [selectedSubmitter, setSelectedSubmitter] = useState("");
  const [showArrived, setShowArrived] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 30;
  const predefinedForwarders = [
    "智联", "AGL", "天习", "永涌", "宜达", "盈和", "鼎旺", "嘉帆", "联宇", "博皓"
  ];

  useEffect(() => {
    document.title = "鲲鹏内部系统v1";
    return () => {
      document.title = "Order System";
    };
  }, []);

  const fetchRecords = async () => {
    try {
      const outboundQuery = new AV.Query("OutboundRequest");
      outboundQuery.containedIn("status", ["已出库", "已发货"]);
      outboundQuery.descending("createdAt").limit(1000);
      const outboundResults = await outboundQuery.find();

      let outboundManageResults = [];
      try {
        const manageQuery = new AV.Query("OutboundManagePage");
        manageQuery.limit(1000);
        outboundManageResults = await manageQuery.find();
      } catch (e) {
        if (e.code === 101) {
          console.warn("OutboundManagePage 类不存在，将使用 OutboundRequest 数据");
        } else {
          throw e;
        }
      }

      let logisticsResults = [];
      try {
        const logisticsQuery = new AV.Query("LogisticsRecord");
        logisticsQuery.limit(1000);
        logisticsResults = await logisticsQuery.find();
      } catch (e) {
        if (e.code === 101) {
          console.warn("LogisticsRecord 类不存在，将使用空数据");
        } else {
          throw e;
        }
      }

      const logisticsMap = new Map(
        logisticsResults.map((r) => [r.get("fba"), { id: r.id, ...r.toJSON() }])
      );
      const outboundManageMap = new Map(
        outboundManageResults.map((r) => [r.get("fba"), r.toJSON()])
      );

      const mergedRecords = outboundResults.map((r) => {
        const outboundData = r.toJSON();
        const logisticsData = logisticsMap.get(outboundData.fba);
        const outboundManageData = outboundManageMap.get(outboundData.fba);
        const record = {
          id: logisticsData?.id || null,
          fba: outboundData.fba || "",
          exportInvoiceNo: logisticsData?.exportInvoiceNo || "",
          country: outboundData.country || "-",
          skus: outboundData.skus || [],
          quantity: Number(outboundData.quantity) || 0,
          operationCartonCount: Number(logisticsData?.operationCartonCount) || 0,
          forwarderCartonCount: Number(logisticsData?.forwarderCartonCount) || 0,
          operationVolume: Number(logisticsData?.operationVolume) || 0,
          forwarderVolume: Number(logisticsData?.forwarderVolume) || 0,
          operationGrossWeight: Number(logisticsData?.operationGrossWeight) || 0,
          forwarderGrossWeight: Number(logisticsData?.forwarderGrossWeight) || 0,
          transportMode: logisticsData?.transportMode || "",
          forwarder: logisticsData?.forwarder || "",
          channel: logisticsData?.channel || "",
          quote: logisticsData?.quote || "",
          etd: logisticsData?.etd || null,
          eta: logisticsData?.eta || null,
          appointmentNo: logisticsData?.appointmentNo || "",
          isArrived: logisticsData?.isArrived ?? false,
          arrivedAt: logisticsData?.arrivedAt || null,
          remarks: logisticsData?.remarks || "",
          fileList: logisticsData?.fileList || [],
          submittedBy: outboundManageData?.submittedBy || outboundData.submittedBy || "未知",
          submittedAt: outboundData.submittedAt || new Date(),
        };
        return record;
      });
      setRecords(mergedRecords);
    } catch (e) {
      console.error("获取记录失败", e);
      setError(`获取记录失败: ${e.message}`);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, skuSearchQuery, selectedCountry, selectedRegionKeys, selectedSubmitter, showArrived, sortOrder]);

  const fetchOutboundData = async (fba) => {
    try {
      const q = new AV.Query("OutboundRequest");
      q.equalTo("fba", fba);
      q.containedIn("status", ["已出库", "已发货"]);
      const res = await q.first();
      if (res) {
        const data = res.toJSON();
        setModalForm((f) => ({
          ...f,
          operationCartonCount: f.operationCartonCount || data.cartonCount || "",
          operationVolume: f.operationVolume || data.volume || "",
          operationGrossWeight: f.operationGrossWeight || data.grossWeight || "",
        }));
      }
    } catch (e) {
      console.error("获取出库数据失败", e);
      setError("获取出库数据失败，请重试");
    }
  };

  const handleModalChange = (e) => {
    const { name, value } = e.target;
    if (name === "forwarderSelect") {
      if (value === "custom") {
        setIsCustomForwarder(true);
        setModalForm((f) => ({ ...f, forwarder: "" }));
      } else {
        setIsCustomForwarder(false);
        setModalForm((f) => ({ ...f, forwarder: value }));
      }
    } else if (name === "customForwarder") {
      setModalForm((f) => ({ ...f, forwarder: value }));
    } else {
      setModalForm((f) => ({ ...f, [name]: value }));
    }
    setError("");
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files).slice(0, 5 - modalForm.files.length);
    setModalForm((f) => ({ ...f, files: [...f.files, ...files] }));
  };

  const removeFile = (idx) => {
    setModalForm((f) => ({ ...f, files: f.files.filter((_, i) => i !== idx) }));
  };

  const handleModalSave = async () => {
    setModalLoading(true);
    try {
      if (isCustomForwarder && !modalForm.forwarder.trim()) {
        throw new Error("自定义货代名称不能为空");
      }
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const Logistics = AV.Object.extend("LogisticsRecord");
      let obj;
      if (modalRecord.id) {
        obj = AV.Object.createWithoutData("LogisticsRecord", modalRecord.id);
      } else {
        obj = new Logistics();
        obj.set("fba", modalRecord.fba);
      }
      obj.set("operationCartonCount", +modalForm.operationCartonCount || 0);
      obj.set("forwarderCartonCount", +modalForm.forwarderCartonCount || 0);
      obj.set("operationVolume", +modalForm.operationVolume || 0);
      obj.set("forwarderVolume", +modalForm.forwarderVolume || 0);
      obj.set("operationGrossWeight", +modalForm.operationGrossWeight || 0);
      obj.set("forwarderGrossWeight", +modalForm.forwarderGrossWeight || 0);
      obj.set("transportMode", modalForm.transportMode);
      obj.set("forwarder", modalForm.forwarder);
      obj.set("channel", modalForm.channel);
      obj.set("quote", modalForm.quote);
      obj.set("etd", modalForm.etd ? new Date(modalForm.etd) : null);
      obj.set("eta", modalForm.eta ? new Date(modalForm.eta) : null);
      obj.set("appointmentNo", modalForm.appointmentNo);
      obj.set("exportInvoiceNo", modalForm.exportInvoiceNo);
      obj.set("remarks", modalForm.remarks);
      obj.set("submittedBy", user.username || "未知");
      obj.set("submittedAt", new Date());
      if (modalForm.files.length) {
        const fileList = modalRecord.fileList ? [...modalRecord.fileList] : [];
        for (let f of modalForm.files) {
          const af = new AV.File(f.name, f);
          await af.save();
          fileList.push({ name: f.name, url: af.url() });
        }
        obj.set("fileList", fileList);
      }
      await obj.save();
      fetchRecords();
      closeModal();
    } catch (e) {
      console.error("保存失败", e);
      setError(`保存失败：${e.message}`);
    } finally {
      setModalLoading(false);
    }
  };

  const handleSetArrived = async (record) => {
    try {
      const Logistics = AV.Object.extend("LogisticsRecord");
      let obj;
      if (record.id) {
        obj = AV.Object.createWithoutData("LogisticsRecord", record.id);
      } else {
        obj = new Logistics();
        obj.set("fba", record.fba);
      }
      obj.set("isArrived", true);
      obj.set("arrivedAt", new Date());
      await obj.save();
      setRecords((prevRecords) =>
        prevRecords.map((r) =>
          r.fba === record.fba
            ? { ...r, isArrived: true, arrivedAt: new Date() }
            : r
        )
      );
    } catch (e) {
      console.error("更新到货状态失败", e);
      setError("更新到货状态失败，请重试");
    }
  };

  const handleSetNotArrived = async (record) => {
    try {
      if (record.id) {
        const obj = AV.Object.createWithoutData("LogisticsRecord", record.id);
        obj.set("isArrived", false);
        obj.set("arrivedAt", null);
        await obj.save();
        setRecords((prevRecords) =>
          prevRecords.map((r) =>
            r.fba === record.fba
              ? { ...r, isArrived: false, arrivedAt: null }
              : r
          )
        );
      }
    } catch (e) {
      console.error("恢复未到货状态失败", e);
      setError("恢复未到货状态失败，请重试");
    }
  };

  const handleCellEdit = async (record, field, value) => {
    try {
      const Logistics = AV.Object.extend("LogisticsRecord");
      let obj;
      if (record.id) {
        obj = AV.Object.createWithoutData("LogisticsRecord", record.id);
      } else {
        obj = new Logistics();
        obj.set("fba", record.fba);
      }
      if (field === "etd" || field === "eta") {
        obj.set(field, value ? new Date(value) : null);
      } else {
        obj.set(field, value);
      }
      await obj.save();
      fetchRecords();
      setEditingCell(null);
    } catch (e) {
      console.error("更新字段失败", e);
      setError(`更新 ${field} 失败，请重试`);
    }
  };

  const openModal = async (record) => {
    setModalRecord(record);
    const isCustom = record.forwarder && !predefinedForwarders.includes(record.forwarder);
    setIsCustomForwarder(isCustom);
    setModalForm({
      operationCartonCount: record.operationCartonCount || "",
      forwarderCartonCount: record.forwarderCartonCount || "",
      operationVolume: record.operationVolume || "",
      forwarderVolume: record.forwarderVolume || "",
      operationGrossWeight: record.operationGrossWeight || "",
      forwarderGrossWeight: record.forwarderGrossWeight || "",
      transportMode: record.transportMode || "",
      forwarder: record.forwarder || "",
      channel: record.channel || "",
      quote: record.quote || "",
      etd: record.etd ? new Date(record.etd).toISOString().split("T")[0] : "",
      eta: record.eta ? new Date(record.eta).toISOString().split("T")[0] : "",
      appointmentNo: record.appointmentNo || "",
      exportInvoiceNo: record.exportInvoiceNo || "",
      remarks: record.remarks || "",
      files: [],
    });
    setModalLoading(true);
    await fetchOutboundData(record.fba);
    setShowModal(true);
    setModalLoading(false);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalRecord(null);
    setIsCustomForwarder(false);
    setModalForm({
      operationCartonCount: "",
      forwarderCartonCount: "",
      operationVolume: "",
      forwarderVolume: "",
      operationGrossWeight: "",
      forwarderGrossWeight: "",
      transportMode: "",
      forwarder: "",
      channel: "",
      quote: "",
      etd: "",
      eta: "",
      appointmentNo: "",
      exportInvoiceNo: "",
      remarks: "",
      files: [],
    });
    setError("");
  };

  const exportToCSV = () => {
    const currentDate = new Date();
    const headers = [
      "FBA号",
      "外销发票号",
      "国家",
      "SKUs",
      "总数量",
      "在途",
      "ETD",
      "ETA",
      "预约单号",
      "信息",
      "状态",
      "提交信息",
      "到货状态",
    ];
    const rows = filteredRecords.map((r) => {
      const transit = calculateTransitDays(r, currentDate);
      return [
        r.fba,
        r.exportInvoiceNo || "-",
        r.country,
        `"${r.skus.join(", ") || "-"}"`,
        r.quantity,
        transit.days,
        formatDate(r.etd),
        formatDate(r.eta),
        r.appointmentNo?.slice(0, 40) || "-",
        InfoBadges({ record: r, forCSV: true }),
        transit.icon,
        `${r.submittedBy} (${formatDate(r.submittedAt)})`,
        r.isArrived ? "已到货" : "未到货",
      ];
    });
    const csvContent = [
      headers.map((h) => `"${h}"`).join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `logistics_export_${today}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  };

  const uniqueCountries = [...new Set(records.map((r) => r.country).filter((c) => c !== "-"))].sort();
  const uniqueSubmitters = [...new Set(records.map((r) => r.submittedBy).filter((s) => s !== "未知"))].sort();

  const sortedRecords = [...records].sort((a, b) => {
    const dateA = new Date(a.submittedAt).getTime();
    const dateB = new Date(b.submittedAt).getTime();
    return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
  });

  const filteredRecords = sortedRecords.filter((r) =>
    [r.fba, r.exportInvoiceNo || ""].some((field) =>
      field.toLowerCase().includes(searchQuery.toLowerCase())
    ) &&
    (!skuSearchQuery || r.skus.some((sku) => sku.toLowerCase().includes(skuSearchQuery.toLowerCase()))) &&
    (!selectedCountry && selectedRegionKeys.length === 0
      ? true
      : selectedCountry
      ? r.country === selectedCountry
      : selectedRegionKeys.includes(r.country)) &&
    (!selectedSubmitter || r.submittedBy === selectedSubmitter) &&
    (showArrived || !r.isArrived)
  );

  const totalPages = Math.ceil(filteredRecords.length / PAGE_SIZE);
  const paginatedRecords = filteredRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const cartonDiff = (+modalForm.forwarderCartonCount || 0) - (+modalForm.operationCartonCount || 0);
  const volumeDiff = (+modalForm.forwarderVolume || 0) - (+modalForm.operationVolume || 0);
  const weightDiff = (+modalForm.forwarderGrossWeight || 0) - (+modalForm.operationGrossWeight || 0);
  const operationChargeableWeight = Math.max(
    (+modalForm.operationVolume || 0) * 167,
    (+modalForm.operationGrossWeight || 0)
  );
  const forwarderChargeableWeight = Math.max(
    (+modalForm.forwarderVolume || 0) * 167,
    (+modalForm.forwarderGrossWeight || 0)
  );
  const chargeableWeightDiff = forwarderChargeableWeight - operationChargeableWeight;

  const isEtaOverdue = (record) => {
    if (!record.eta || record.appointmentNo || record.isArrived) return false;
    const etaDate = new Date(record.eta);
    const now = new Date();
    return etaDate < now && !isNaN(etaDate.getTime());
  };

  const clearFilters = () => {
    setSelectedCountry("");
    setSelectedRegionKeys([]);
    setSearchQuery("");
    setSkuSearchQuery("");
    setSelectedSubmitter("");
  };

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  return (
    <div className="p-6 min-h-screen bg-gray-100">
      <h1 className="text-3xl font-bold text-blue-800 mb-8 border-b pb-2">🚚 物流总表</h1>
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <input
              type="text"
              placeholder="搜索 FBA号 或 外销发票号"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={toggleSortOrder}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
            >
              按提交时间排序 ({sortOrder === "desc" ? "新到旧" : "旧到新"})
            </button>
            <select
              value={selectedCountry}
              onChange={(e) => {
                setSelectedCountry(e.target.value);
                setSelectedRegionKeys([]);
              }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">按国家筛选 (全部)</option>
              {uniqueCountries.map((country) => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
            <button
              onClick={clearFilters}
              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors"
            >
              清除筛选
            </button>
            <select
              value={selectedSubmitter}
              onChange={(e) => setSelectedSubmitter(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">按提交人筛选 (全部)</option>
              {uniqueSubmitters.map((submitter) => (
                <option key={submitter} value={submitter}>{submitter}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="搜索 SKU"
              value={skuSearchQuery}
              onChange={(e) => setSkuSearchQuery(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={() => setShowArrived(!showArrived)}
              className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700 transition-colors"
            >
              {showArrived ? "隐藏已入库货件" : "显示已入库货件"}
            </button>
          </div>
          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors"
          >
            导出 CSV
          </button>
        </div>
        <StatsDashboard
          records={records}
          setSelectedCountry={setSelectedCountry}
          setSelectedRegionKeys={setSelectedRegionKeys}
        />
        <Section title="已出库货件（点击补充物流信息）">
          <div className="overflow-x-auto">
            <table className="w-full border rounded-md text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 border-b">FBA号</th>
                  <th className="px-4 py-2 border-b">外销发票号</th>
                  <th className="px-4 py-2 border-b">国家</th>
                  <th className="px-4 py-2 border-b">SKUs</th>
                  <th className="px-4 py-2 border-b">总数量</th>
                  <th className="px-4 py-2 border-b">在途</th>
                  <th className="px-4 py-2 border-b">ETD</th>
                  <th className="px-4 py-2 border-b">ETA</th>
                  <th className="px-4 py-2 border-b">预约单号</th>
                  <th className="px-4 py-2 border-b">信息</th>
                  <th className="px-4 py-2 border-b">状态</th>
                  <th className="px-4 py-2 border-b">提交信息</th>
                  <th className="px-4 py-2 border-b">操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRecords.length === 0 ? (
                  <tr>
                    <td colSpan="13" className="text-center py-4 text-gray-500">
                      {filteredRecords.length === 0
                        ? (searchQuery || skuSearchQuery || selectedCountry || selectedRegionKeys.length || selectedSubmitter ? "无匹配记录" : "暂无已出库货件")
                        : `第 ${currentPage} 页暂无数据`}
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((r) => {
                    const transit = calculateTransitDays(r, new Date());
                    return (
                      <tr
                        key={r.fba}
                        className="hover:bg-gray-50 cursor-pointer bg-transparent"
                        onClick={() => openModal(r)}
                      >
                        <td className="px-4 py-2 border-b">{r.fba}</td>
                        <td
                          className="px-4 py-2 border-b"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {editingCell === `${r.fba}-exportInvoiceNo` ? (
                            <input
                              type="text"
                              defaultValue={r.exportInvoiceNo}
                              onBlur={(e) => handleCellEdit(r, "exportInvoiceNo", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleCellEdit(r, "exportInvoiceNo", e.target.value);
                                }
                              }}
                              className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={() => setEditingCell(`${r.fba}-exportInvoiceNo`)}
                              className="block w-full"
                            >
                              {r.exportInvoiceNo || "-"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 border-b">{r.country}</td>
                        <td className="px-4 py-2 border-b relative group">
                          <span className="block w-full">{r.skus[0] || "-"}</span>
                          {r.skus.length > 0 && (
                            <div className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded-md px-3 py-2 z-10 -mt-1 left-0 max-w-xs break-words">
                              {r.skus.join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 border-b">{r.quantity}</td>
                        <td className="px-4 py-2 border-b">{transit.days}</td>
                        <td
                          className="px-4 py-2 border-b"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {editingCell === `${r.fba}-etd` ? (
                            <input
                              type="date"
                              defaultValue={r.etd ? new Date(r.etd).toISOString().split("T")[0] : ""}
                              onBlur={(e) => handleCellEdit(r, "etd", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleCellEdit(r, "etd", e.target.value);
                                }
                              }}
                              className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={() => setEditingCell(`${r.fba}-etd`)}
                              className="block w-full"
                            >
                              {formatDate(r.etd)}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-4 py-2 border-b"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {editingCell === `${r.fba}-eta` ? (
                            <input
                              type="date"
                              defaultValue={r.eta ? new Date(r.eta).toISOString().split("T")[0] : ""}
                              onBlur={(e) => handleCellEdit(r, "eta", e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleCellEdit(r, "eta", e.target.value)}
                              className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={() => setEditingCell(`${r.fba}-eta`)}
                              className="block w-full"
                            >
                              {formatDate(r.eta)}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-4 py-2 border-b text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {editingCell === `${r.fba}-appointmentNo` ? (
                            <input
                              type="text"
                              defaultValue={r.appointmentNo}
                              onBlur={(e) => handleCellEdit(r, "appointmentNo", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleCellEdit(r, "appointmentNo", e.target.value);
                                }
                              }}
                              className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={() => setEditingCell(`${r.fba}-appointmentNo`)}
                              className="block w-full"
                            >
                              {r.appointmentNo?.slice(0, 40) || "-"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 border-b">
                          <InfoBadges record={r} />
                        </td>
                        <td className="px-4 py-2 border-b">{transit.icon}</td>
                        <td className="px-4 py-2 border-b">
                          {r.submittedBy} ({formatDate(r.submittedAt)})
                        </td>
                        <td className="px-4 py-2 border-b">
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetArrived(r);
                              }}
                              className={`px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 ${r.isArrived ? "opacity-50 cursor-not-allowed" : ""}`}
                              disabled={r.isArrived}
                              title="标记为已到货"
                            >
                              ✅
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetNotArrived(r);
                              }}
                              className={`px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 ${!r.isArrived ? "opacity-50 cursor-not-allowed" : ""}`}
                              disabled={!r.isArrived}
                              title="恢复到未到货"
                            >
                              ↩️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
          {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
        </Section>
      </div>

      {showModal && modalRecord && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 animate-fade-in">
          <div className="bg-white rounded-xl shadow-lg w-3/5 max-h-[85vh] overflow-y-auto p-8 relative">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl"
            >
              ×
            </button>
            <h3 className="text-2xl font-semibold text-blue-800 mb-6">补充物流信息</h3>
            {modalLoading ? (
              <p className="text-gray-500">加载中...</p>
            ) : (
              <div className="space-y-6 text-sm">
                <fieldset className="border border-gray-200 p-4 rounded-lg">
                  <legend className="text-sm font-medium text-gray-700">基本信息</legend>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">FBA号</label>
                      <input
                        value={modalRecord.fba}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">国家</label>
                      <input
                        value={modalRecord.country}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">SKUs</label>
                      <input
                        value={modalRecord.skus[0] || "-"}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">总数量</label>
                      <input
                        value={modalRecord.quantity}
                        readOnly
                        className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                      />
                    </div>
                  </div>
                </fieldset>
                <fieldset className="border border-gray-200 p-4 rounded-lg">
                  <legend className="text-sm font-medium text-gray-700">物流数据</legend>
                  <div className="space-y-4">
                    <div className="flex items-end gap-4">
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">运营箱数</label>
                        <input
                          name="operationCartonCount"
                          type="number"
                          value={modalForm.operationCartonCount}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="请输入运营箱数"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">货代箱数</label>
                        <input
                          name="forwarderCartonCount"
                          type="number"
                          value={modalForm.forwarderCartonCount}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="请输入货代箱数"
                        />
                      </div>
                      <div className="w-24">
                        <span className={`text-sm ${cartonDiff === 0 ? "text-green-600" : "text-red-600"}`}>
                          差异: {cartonDiff}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">运营体积 (m³)</label>
                        <input
                          name="operationVolume"
                          type="number"
                          step="0.01"
                          value={modalForm.operationVolume}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="请输入运营体积"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">货代体积 (m³)</label>
                        <input
                          name="forwarderVolume"
                          type="number"
                          step="0.01"
                          value={modalForm.forwarderVolume}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="请输入货代体积"
                        />
                      </div>
                      <div className="w-24">
                        <span className={`text-sm ${volumeDiff === 0 ? "text-green-600" : "text-red-600"}`}>
                          差异: {volumeDiff.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">运营毛重 (kg)</label>
                        <input
                          name="operationGrossWeight"
                          type="number"
                          step="0.01"
                          value={modalForm.operationGrossWeight}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="请输入运营毛重"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">货代毛重 (kg)</label>
                        <input
                          name="forwarderGrossWeight"
                          type="number"
                          step="0.01"
                          value={modalForm.forwarderGrossWeight}
                          onChange={handleModalChange}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="请输入货代毛重"
                        />
                      </div>
                      <div className="w-24">
                        <span className={`text-sm ${weightDiff === 0 ? "text-green-600" : "text-red-600"}`}>
                          差异: {weightDiff.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">运营计费重 (kg)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={operationChargeableWeight.toFixed(2)}
                          readOnly
                          className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block font-medium text-gray-700 mb-1">货代计费重 (kg)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={forwarderChargeableWeight.toFixed(2)}
                          readOnly
                          className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100 text-gray-600"
                        />
                      </div>
                      <div className="w-24">
                        <span className={`text-sm ${chargeableWeightDiff === 0 ? "text-green-600" : "text-red-600"}`}>
                          差异: {chargeableWeightDiff.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </fieldset>
                <fieldset className="border border-gray-200 p-4 rounded-lg">
                  <legend className="text-sm font-medium text-gray-700">货代与时间轴</legend>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">运输方式</label>
                      <select
                        name="transportMode"
                        value={modalForm.transportMode}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">请选择运输方式</option>
                        {["海运", "空运", "铁路", "快递"].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">货代</label>
                      <select
                        name="forwarderSelect"
                        value={isCustomForwarder ? "custom" : modalForm.forwarder || ""}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">请选择货代</option>
                        {predefinedForwarders.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                        <option value="custom">自定义</option>
                      </select>
                      {isCustomForwarder && (
                        <div className="mt-2">
                          <label className="block font-medium text-gray-700 mb-1">自定义货代名称</label>
                          <input
                            name="customForwarder"
                            value={modalForm.forwarder}
                            onChange={handleModalChange}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="请输入货代名称"
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">渠道</label>
                      <select
                        name="channel"
                        value={modalForm.channel}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">请选择渠道</option>
                        {["海卡自税", "海卡不包税", "海卡包税", "海派", "铁卡自税", "铁卡包税", "卡航", "快船包税"].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">货代报价</label>
                      <input
                        name="quote"
                        value={modalForm.quote}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="请输入货代报价"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">ETD</label>
                      <input
                        name="etd"
                        type="date"
                        value={modalForm.etd}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">ETA</label>
                      <input
                        name="eta"
                        type="date"
                        value={modalForm.eta}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">预约单号</label>
                      <input
                        name="appointmentNo"
                        value={modalForm.appointmentNo}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="请输入预约单号"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">外销发票号</label>
                      <input
                        name="exportInvoiceNo"
                        value={modalForm.exportInvoiceNo}
                        onChange={handleModalChange}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="请输入外销发票号"
                      />
                    </div>
                  </div>
                </fieldset>
                <fieldset className="border border-gray-200 p-4 rounded-lg">
                  <legend className="text-sm font-medium text-gray-700">备注与附件</legend>
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">备注</label>
                    <textarea
                      name="remarks"
                      value={modalForm.remarks}
                      onChange={handleModalChange}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="请输入备注"
                      rows="3"
                    />
                  </div>
                  <div className="mt-4">
                    <label className="block font-medium text-gray-700 mb-1">上传文件（最多5个）</label>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                      onChange={handleFileChange}
                      className="w-full file:rounded-md file:bg-blue-50 file:text-blue-600 file:text-sm file:py-1 file:px-3 file:border-0"
                    />
                    <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                      {modalForm.files.map((f, i) => (
                        <div key={i} className="flex items-center bg-gray-100 px-4 py-1 rounded-md text-sm">
                          <span className="truncate mr-2" title={f.name}>
                            {getFileIcon(f.name)} {f.name}
                          </span>
                          <button onClick={() => removeFile(i)} className="text-red-500 hover:text-red-700">
                            ×
                          </button>
                        </div>
                      ))}
                      {modalRecord.fileList?.map((f, i) => (
                        <div key={`existing-${i}`} className="flex items-center bg-gray-100 px-4 py-2 rounded-md text-sm">
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate mr-2 text-blue-600 hover:text-blue-500"
                          >
                            {getFileIcon(f.name)} {f.name}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                </fieldset>
                {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={closeModal}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleModalSave}
                    disabled={modalLoading}
                    className={`px-4 py-2 bg-blue-600 text-white rounded-md text-sm transition-colors ${modalLoading ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"}`}
                  >
                    {modalLoading ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}