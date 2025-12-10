import React, { useEffect, useState } from "react";
import AV from "../leancloud";
import * as XLSX from "xlsx";

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

const StatusBadge = ({ status }) => {
  const map = {
    待提交: "bg-yellow-100 text-yellow-800",
    已提交: "bg-blue-100 text-blue-800",
    已出库: "bg-green-100 text-green-800",
    异常: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`px-2 py-0.5 text-xs rounded-full font-medium ${
        map[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status}
    </span>
  );
};

export default function WarehouseActionPage() {
  const [list, setList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [modal, setModal] = useState(null);

  const [qtyMap, setQtyMap] = useState({});
  const [savedQty, setSavedQty] = useState({});
  const [stockMap, setStockMap] = useState({});

  const [loading, setLoading] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);

  const [searchFba, setSearchFba] = useState("");
  const [searchSku, setSearchSku] = useState("");
  const [filterCountry, setFilterCountry] = useState("全部");
  const [filterMonth, setFilterMonth] = useState("全部");

  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;

  useEffect(() => {
    fetchList();
  }, []);

  const fetchList = async () => {
    setLoading(true);
    try {
      const q = new AV.Query("OutboundRequest");
      q.containedIn("status", ["已提交", "已出库", "异常"]);
      q.equalTo("warehouse", "知客仓");
      q.descending("createdAt");
      const res = await q.find();
      const data = res.map((r) => ({ id: r.id, ...r.toJSON() }));
      setList(data);
      setFilteredList(data);
    } catch (err) {
      alert("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let result = [...list];

    if (searchFba.trim()) {
      result = result.filter((r) =>
        r.fba?.toLowerCase().includes(searchFba.toLowerCase())
      );
    }

    if (searchSku.trim()) {
      result = result.filter((r) => {
        const skus = Array.isArray(r.skus) ? r.skus : [r.sku];
        return skus.some((sku) =>
          sku?.toLowerCase().includes(searchSku.toLowerCase())
        );
      });
    }

    if (filterCountry !== "全部") {
      result = result.filter((r) => r.country === filterCountry);
    }

    if (filterMonth !== "全部") {
      result = result.filter((r) => {
        if (!r.submittedAt) return false;
        const date = new Date(r.submittedAt);
        const m = `${date.getFullYear()}-${date.getMonth() + 1}`;
        return m === filterMonth;
      });
    }

    setFilteredList(result);
    setCurrentPage(1);
  }, [list, searchFba, searchSku, filterCountry, filterMonth]);

  const fetchStocks = async (skus) => {
    const q = new AV.Query("StockItem");
    q.containedIn("sku", skus);
    const res = await q.find();
    const map = {};
    res.forEach((i) => {
      map[i.get("sku")] = i.get("quantity") || 0;
    });
    return map;
  };

  const openModal = async (record) => {
    const skus = Array.isArray(record.skus) ? record.skus : [record.sku];
    const initMap = {};
    skus.forEach((sku) => (initMap[sku] = ""));
    const stock = await fetchStocks(skus);

    setModal(record);
    setQtyMap(initMap);
    setSavedQty({});
    setStockMap(stock);
  };

  const saveQty = (sku) => {
    const val = Number(qtyMap[sku]);
    const available = stockMap[sku] || 0;

    if (!val || val <= 0) return alert("请输入有效数量");
    if (val > available) return alert(`数量不能超过库存（${available}）`);

    setSavedQty((prev) => ({ ...prev, [sku]: val }));
    alert(`已保存 ${sku} 出库数量：${val}`);
  };

  const confirmOutbound = async () => {
    if (!modal) return;

    const skus = Array.isArray(modal.skus) ? modal.skus : [modal.sku];
    const missing = skus.filter((sku) => savedQty[sku] === undefined);

    if (missing.length > 0) return alert("请保存所有 SKU 的数量");

    try {
      for (let sku of skus) {
        const q = new AV.Query("StockItem");
        q.equalTo("sku", sku);
        const stockItem = await q.first();
        if (stockItem) {
          stockItem.increment("quantity", -savedQty[sku]);
          await stockItem.save();
        }
      }

      const obj = AV.Object.createWithoutData("OutboundRequest", modal.id);
      obj.set("status", "已出库");
      obj.set("shippedDetail", savedQty);
      await obj.save();

      alert("出库成功");
      setModal(null);
      fetchList();
    } catch (err) {
      alert("出库失败：" + err.message);
    }
  };

  const markException = async () => {
    const obj = AV.Object.createWithoutData("OutboundRequest", modal.id);
    obj.set("status", "异常");
    await obj.save();
    alert("已标记为异常");
    setModal(null);
    fetchList();
  };

  const forceComplete = async () => {
    const obj = AV.Object.createWithoutData("OutboundRequest", modal.id);
    obj.set("status", "已出库");
    await obj.save();
    alert("强制完成成功");
    setModal(null);
    fetchList();
  };

  // =====================================================
  // ⭐ 新版数据提取：A3-A8 SKU → 匹配任务 SKU → 读取 C 列数量
  // =====================================================
  const handleDataExtract = async (url) => {
    try {
      setLoading(true);
      setExtractProgress(0);

      const res = await fetch(url);
      if (!res.ok) throw new Error("下载 Excel 失败");
      const buf = await res.arrayBuffer();

      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("Excel 没有可用工作表");

      const excelSkus = [];
      for (let r = 3; r <= 8; r++) {
        const cell = sheet[`A${r}`];
        if (cell?.v) excelSkus.push(String(cell.v).trim());
      }

      if (excelSkus.length === 0) throw new Error("A3–A8 未找到任何 SKU");

      const taskSkus = Array.isArray(modal.skus) ? modal.skus : [modal.sku];
      const newQty = {};
      const errors = [];

      const range = XLSX.utils.decode_range(sheet["!ref"]);

      for (let i = 0; i < excelSkus.length; i++) {
        const sku = excelSkus[i];
        setExtractProgress(Math.round(((i + 1) / excelSkus.length) * 100));

        if (!taskSkus.includes(sku)) {
          errors.push(`${sku} 不在任务 SKU 中`);
          continue;
        }

        let row = null;
        for (let r = 1; r <= range.e.r; r++) {
          const cellA = sheet[`A${r}`];
          if (cellA?.v && String(cellA.v).trim() === sku) {
            row = r;
            break;
          }
        }
        if (!row) {
          errors.push(`${sku} 未在 Excel 中找到`);
          continue;
        }

        const qtyCell = sheet[`C${row}`];
        const qty = qtyCell ? Number(qtyCell.v) : null;

        if (!qty || qty <= 0) {
          errors.push(`${sku} 数量无效`);
          continue;
        }

        newQty[sku] = qty;
      }

      setQtyMap((prev) => ({ ...prev, ...newQty }));

      setLoading(false);
      setExtractProgress(100);

      let msg = "提取完成\n";
      if (Object.keys(newQty).length > 0)
        msg += `成功：${Object.keys(newQty).join(", ")}\n`;
      if (errors.length > 0) msg += "\n问题：\n" + errors.join("\n");

      alert(msg);
    } catch (err) {
      setLoading(false);
      alert("失败：" + err.message);
    }
  };

  // ================ UI 区域 ================

  const getRowStyle = (status) => {
    if (status === "已出库" || status === "异常")
      return "bg-gray-100 text-gray-500";
    return "";
  };

  const countryOptions = [
    "全部",
    ...new Set(list.map((r) => r.country).filter(Boolean)),
  ];

  const getMonthOptions = () => {
    const arr = ["全部"];
    const startYear = 2025;
    const startMonth = 5;
    for (let i = 0; i < 12; i++) {
      const m = startMonth + i;
      const realYear = startYear + Math.floor((m - 1) / 12);
      const realMonth = ((m - 1) % 12) + 1;
      arr.push(`${realYear}-${realMonth}`);
    }
    return arr;
  };

  const totalPages = Math.ceil(filteredList.length / rowsPerPage);
  const paginated = filteredList.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const renderPagination = () =>
    totalPages > 1 && (
      <div className="flex justify-center gap-3 mt-4">
        <button
          disabled={currentPage === 1}
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
        >
          上一页
        </button>
        <span>
          第 {currentPage} / {totalPages} 页
        </span>
        <button
          disabled={currentPage === totalPages}
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
        >
          下一页
        </button>
      </div>
    );

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-blue-700 mb-6">🏷 仓库操作</h1>

      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <label className="block text-sm">搜索 FBA</label>
          <input
            value={searchFba}
            onChange={(e) => setSearchFba(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm">搜索 SKU</label>
          <input
            value={searchSku}
            onChange={(e) => setSearchSku(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm">按国别</label>
          <select
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            {countryOptions.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm">按月份</label>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            {getMonthOptions().map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-gray-500">加载中…</p>}

      {paginated.length === 0 && !loading && (
        <p className="text-gray-500">暂无记录</p>
      )}

      {paginated
        .sort((a, b) => {
          const map = { 已提交: 0, 已出库: 1, 异常: 2 };
          return map[a.status] - map[b.status];
        })
        .map((r) => (
          <div
            key={r.id}
            onDoubleClick={() => openModal(r)}
            className={`flex justify-between items-center bg-white border p-4 rounded mb-3 shadow-sm cursor-pointer hover:shadow ${getRowStyle(
              r.status
            )}`}
          >
            <div className="text-sm space-y-1">
              <p className="font-medium">FBA：{r.fba}</p>

              {r.status === "已出库" && r.shippedDetail ? (
                <div>
                  {Object.entries(r.shippedDetail).map(([sku, qty]) => (
                    <p key={sku}>
                      {sku}（出库 {qty}）
                    </p>
                  ))}
                </div>
              ) : (
                <p>
                  SKU：
                  {Array.isArray(r.skus) ? r.skus.join(", ") : r.sku}
                </p>
              )}

              <p>国别：{r.country}</p>
              <p className="text-xs text-gray-500">
                提交人：{r.submittedBy}（{formatDate(r.submittedAt)}）
              </p>
            </div>

            <div>
              <StatusBadge status={r.status} />
            </div>
          </div>
        ))}

      {renderPagination()}

      {/* ================================ */}
      {/* Modal */}
      {/* ================================ */}
      {modal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg w-[600px] max-h-[80vh] p-6 overflow-y-auto relative">
            <button
              onClick={() => setModal(null)}
              className="absolute top-3 right-3 text-gray-500 hover:text-black"
            >
              ×
            </button>

            <h2 className="text-lg font-bold mb-4">出库详情</h2>

            <div className="text-sm space-y-2">
              <p>
                <strong>FBA：</strong>
                {modal.fba || "-"}
              </p>
              <p>
                <strong>国别：</strong>
                {modal.country}
              </p>
              <p>
                <strong>总箱数：</strong>
                {modal.cartonCount}
              </p>
              <p>
                <strong>总体积：</strong>
                {modal.volume}
              </p>
              <p>
                <strong>总重量：</strong>
                {modal.grossWeight}
              </p>

              <p className="mt-2 font-semibold">SKU 数量填写：</p>

              {(Array.isArray(modal.skus) ? modal.skus : [modal.sku]).map(
                (sku) => (
                  <div key={sku} className="flex items-center gap-2 mb-1">
                    <span className="w-24">{sku}</span>
                    <input
                      type="number"
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      value={qtyMap[sku] || ""}
                      onChange={(e) =>
                        setQtyMap((prev) => ({
                          ...prev,
                          [sku]: e.target.value,
                        }))
                      }
                      placeholder={`库存 ${stockMap[sku] || 0}`}
                    />
                    <button
                      onClick={() => saveQty(sku)}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm"
                    >
                      保存
                    </button>
                  </div>
                )
              )}

              {/* 附件列表 */}
              {modal.fileList?.length > 0 && (
                <div className="mt-3">
                  <p className="font-semibold">附件：</p>

                  <ul className="list-disc ml-6 text-xs space-y-1">
                    {modal.fileList.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {f.name}
                        </a>

                        {(f.name.toLowerCase().endsWith(".xls") ||
                          f.name.toLowerCase().endsWith(".xlsx")) && (
                          <button
                            className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs"
                            onClick={() => handleDataExtract(f.url)}
                          >
                            数据提取
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 提取进度条 */}
              {loading && (
                <div className="mt-4">
                  <p className="text-sm text-blue-600 mb-1">
                    数据提取中… {extractProgress}%
                  </p>
                  <div className="w-full h-2 bg-gray-200 rounded">
                    <div
                      className="h-2 bg-blue-600 rounded"
                      style={{ width: `${extractProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* 按钮区域 */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={confirmOutbound}
                  className="px-4 py-2 bg-green-600 text-white rounded text-sm"
                >
                  确认出库
                </button>

                <button
                  onClick={markException}
                  className="px-4 py-2 bg-red-500 text-white rounded text-sm"
                >
                  标记异常
                </button>

                <button
                  onClick={forceComplete}
                  className="px-4 py-2 bg-gray-600 text-white rounded text-sm"
                >
                  强制完成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
