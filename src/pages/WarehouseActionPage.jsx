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
  const [searchFba, setSearchFba] = useState("");
  const [searchSku, setSearchSku] = useState("");
  const [filterCountry, setFilterCountry] = useState("全部");
  const [filterMonth, setFilterMonth] = useState("全部");
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;

  useEffect(() => {
    document.title = "鲲鹏内部系统v1";
    fetchList();
    return () => {
      document.title = "Warehouse System";
    };
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
      console.error("加载失败", err);
      alert("加载数据失败，请稍后重试");
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
        const monthYear = `${date.getFullYear()}-${date.getMonth() + 1}`;
        return monthYear === filterMonth;
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
    skus.forEach((sku) => {
      initMap[sku] = "";
    });
    const stock = await fetchStocks(skus);
    setModal(record);
    setQtyMap(initMap);
    setSavedQty({});
    setStockMap(stock);
  };

  const saveQty = (sku) => {
    const val = parseInt(qtyMap[sku]);
    const available = stockMap[sku] || 0;
    if (isNaN(val) || val <= 0) return alert("请输入有效出库数量");
    if (val > available)
      return alert(`SKU ${sku} 出库数量不能超过库存（${available}）`);
    setSavedQty((prev) => ({ ...prev, [sku]: val }));
    alert(`✅ ${sku} 出库数量已保存：${val}`);
  };

  const confirmOutbound = async () => {
    if (!modal) return;
    const allSkus = Array.isArray(modal.skus) ? modal.skus : [modal.sku];
    const unset = allSkus.filter((sku) => savedQty[sku] === undefined);
    if (unset.length > 0) {
      alert("请填写并保存所有 SKU 的出库数量后再确认");
      return;
    }

    try {
      for (let sku of allSkus) {
        const qty = savedQty[sku];
        const q = new AV.Query("StockItem");
        q.equalTo("sku", sku);
        const stockItem = await q.first();
        if (stockItem) {
          stockItem.increment("quantity", -qty);
          await stockItem.save();
        }
      }

      const obj = AV.Object.createWithoutData("OutboundRequest", modal.id);
      obj.set("status", "已出库");
      obj.set("shippedDetail", savedQty);
      await obj.save();

      setModal(null);
      fetchList();
    } catch (err) {
      console.error("确认出库失败", err);
      alert("出库失败，请稍后重试");
    }
  };

  const markException = async () => {
    if (!modal) return;
    const obj = AV.Object.createWithoutData("OutboundRequest", modal.id);
    obj.set("status", "异常");
    await obj.save();
    setModal(null);
    fetchList();
  };

  const forceComplete = async () => {
    if (!modal) return;
    const obj = AV.Object.createWithoutData("OutboundRequest", modal.id);
    obj.set("status", "已出库");
    await obj.save();
    setModal(null);
    fetchList();
  };

  const handlePrint = (url, fileName) => {
    const pdfWindow = window.open(url, '_blank');
    if (!pdfWindow) {
      alert("无法打开 PDF，请检查浏览器是否阻止了弹出窗口");
    } else {
      pdfWindow.document.title = `查看 PDF: ${fileName}`;
    }
  };

  const cleanString = (str) => {
    if (str === null || str === undefined) return '';
    const raw = str.toString().trim();
    const match = raw.match(/(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)/i);
    if (match) return match[0].toUpperCase();
    return raw.replace(/[\n\r\t\u00A0\u200B\s]+/g, '').toUpperCase();
  };

  const extractFbaFromUrl = (url) => {
    const match = url.match(/(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)/i);
    return match ? match[0].toUpperCase() : null;
  };

  const handleDataExtract = async (url) => {
    try {
      const targetFba = cleanString(modal?.fba || '');
      console.log("modal:", modal);
      console.log("Target FBA:", { raw: modal?.fba, cleaned: targetFba });
      if (!modal?.fba) {
        console.log("No FBA number provided in modal");
        throw new Error("FBA号未定义");
      }
      if (!/^(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)$/i.test(targetFba)) {
        console.log("Invalid modal.fba:", { raw: modal.fba, cleaned: targetFba });
        throw new Error(`FBA号格式错误：${modal.fba}（需 FBA+9位字母数字 或 STAR-开头+字母数字）`);
      }

      // Check if data already exists in FbaSkuData
      console.log("Checking FbaSkuData for existing data:", { targetFba, url });
      const qCheck = new AV.Query("FbaSkuData");
      qCheck.equalTo("fba", targetFba);
      qCheck.equalTo("fileUrl", url);
      const existingData = await qCheck.find();
      let extractedData = existingData.map(r => r.toJSON());

      if (existingData.length > 0) {
        console.log("Data already exists in FbaSkuData:", extractedData);
      } else {
        // Fetch and parse Excel
        console.log("Fetching Excel:", url);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`无法下载 Excel 文件：HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        
        console.log("Parsing Excel...");
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:ZZ9999');
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

        const foundFbas = [];
        let fbaRow = -1;
        let fbaValue = targetFba;
        let nextFbaRow = json.length;

        console.log("Searching cells...");
        for (let row = 0; row <= Math.max(range.e.r, json.length - 1); row++) {
          for (let col = 0; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = sheet[cellAddress];
            if (cell && cell.v !== undefined) {
              const rawValue = cell.v.toString();
              const cellValue = cleanString(rawValue);
              console.log(`Cell [${cellAddress}]: raw=${rawValue}, cleaned=${cellValue}, type=${typeof cell.v}`);
              if (cellValue && /^(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)$/i.test(cellValue)) {
                foundFbas.push({ raw: rawValue, cleaned: cellValue, row, col });
                if (cellValue === targetFba && fbaRow === -1) {
                  fbaValue = cellValue;
                  fbaRow = row;
                } else if (fbaRow !== -1 && cellValue !== targetFba && row > fbaRow) {
                  nextFbaRow = Math.min(nextFbaRow, row);
                }
              } else if (rawValue.match(/(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)/i)) {
                const match = rawValue.match(/(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)/i);
                if (match) {
                  const fba = match[0].toUpperCase();
                  foundFbas.push({ raw: rawValue, cleaned: fba, row, col, note: 'Matched in raw' });
                  if (fba === targetFba && fbaRow === -1) {
                    fbaValue = fba;
                    fbaRow = row;
                  } else if (fbaRow !== -1 && fba !== targetFba && row > fbaRow) {
                    nextFbaRow = Math.min(nextFbaRow, row);
                  }
                }
              }
            }
          }
        }

        if (sheet['!merges']) {
          console.log("Checking merged cells...");
          for (const merge of sheet['!merges']) {
            const startCell = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
            const cell = sheet[startCell];
            if (cell && cell.v !== undefined) {
              const rawValue = cell.v.toString();
              const cellValue = cleanString(rawValue);
              console.log(`Merged cell [${startCell}]: raw=${rawValue}, cleaned=${cellValue}, type=${typeof cell.v}`);
              if (cellValue && /^(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)$/i.test(cellValue)) {
                foundFbas.push({ raw: rawValue, cleaned: cellValue, row: merge.s.r, col: startCell });
                if (cellValue === targetFba && fbaRow === -1) {
                  fbaValue = cellValue;
                  fbaRow = merge.s.r;
                } else if (fbaRow !== -1 && cellValue !== targetFba && merge.s.r > fbaRow) {
                  nextFbaRow = Math.min(nextFbaRow, merge.s.r);
                }
              } else if (rawValue.match(/(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)/i)) {
                const match = rawValue.match(/(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)/i);
                if (match) {
                  const fba = match[0].toUpperCase();
                  foundFbas.push({ raw: rawValue, cleaned: fba, row: merge.s.r, col: startCell, note: 'Matched in raw' });
                  if (fba === targetFba && fbaRow === -1) {
                    fbaValue = fba;
                    fbaRow = merge.s.r;
                  } else if (fbaRow !== -1 && fba !== targetFba && merge.s.r > fbaRow) {
                    nextFbaRow = Math.min(nextFbaRow, merge.s.r);
                  }
                }
              }
            }
          }
        }

        if (fbaRow === -1) {
          const urlFba = extractFbaFromUrl(url);
          if (urlFba === targetFba) {
            console.warn("FBA number found in URL, proceeding with default fbaValue:", fbaValue);
            fbaRow = 0;
          } else {
            console.warn("No FBA number found in sheet or URL, proceeding with default fbaValue:", fbaValue);
            fbaRow = 0;
          }
        }

        console.log("Searching header after row:", fbaRow);
        let headerRow = -1;
        let skuCol = -1;
        let qtyCol = -1;
        for (let row = fbaRow; row < nextFbaRow && row < json.length; row++) {
          const rowData = json[row];
          if (rowData && rowData.some(cell => cell && typeof cell === 'string' && cell.trim())) {
            const headers = rowData;
            skuCol = headers.findIndex((h) =>
              ["SKU", "MSKU", "亚马逊SKU", "Amazon SKU", "亚马逊MSKU"].some((key) =>
                h?.toString().toLowerCase().replace(/\s/g, '').includes(key.toLowerCase())
              )
            );
            qtyCol = headers.findIndex((h) =>
              ["发货数量", "数量", "Quantity", "Shipped Quantity", "US发货数量", "US Quantity"].some((key) =>
                h?.toString().toLowerCase().replace(/\s/g, '').includes(key.toLowerCase())
              )
            );
            console.log(`Checking row ${row} for headers:`, { headers, skuCol, qtyCol });
            if (skuCol !== -1 && qtyCol !== -1) {
              headerRow = row;
              break;
            }
          }
        }

        if (headerRow === -1) {
          console.log("No header found after FBA row:", { fbaRow, nextFbaRow, json: json.slice(fbaRow, fbaRow + 10) });
          throw new Error("未找到有效数据表头（需要 SKU/MSKU 和 发货数量/US发货数量 列）");
        }

        console.log("Header found:", { headerRow, skuCol, qtyCol, headers: json[headerRow] });

        console.log("Extracting data from row", headerRow + 1, "to", nextFbaRow);
        extractedData = [];
        for (let row = headerRow + 1; row < nextFbaRow && row < json.length; row++) {
          const rowData = json[row];
          if (!rowData || !rowData[skuCol]) {
            console.log("Stopped at empty row:", { row, rowData });
            break;
          }

          if (rowData.some(cell => cell?.toString().toLowerCase().includes('total') || 
                                  cell?.toString().toLowerCase().includes('仓点') || 
                                  cell?.toString().match(/(FBA[A-Z0-9]{9}|STAR-[A-Z0-9]+)/i))) {
            console.log("Stopped at termination row:", { row, rowData });
            break;
          }

          const sku = cleanString(rowData[skuCol]);
          const qty = parseInt(rowData[qtyCol]);

          if (sku && !isNaN(qty) && qty > 0) {
            extractedData.push({ fba: fbaValue, sku, quantity: qty, fileUrl: url, row });
            console.log("Extracted:", { sku, quantity: qty, row });
          } else {
            console.log("Skipped invalid row:", { row, sku, qty, rowData });
          }
        }

        if (extractedData.length === 0) {
          console.log("No valid data:", { dataRows: json.slice(headerRow + 1, nextFbaRow) });
          throw new Error("未找到有效 SKU 数据");
        }

        // Save to FbaSkuData
        console.log("Saving to FbaSkuData:", extractedData);
        for (const data of extractedData) {
          const obj = new AV.Object("FbaSkuData");
          obj.set("fba", data.fba);
          obj.set("sku", data.sku);
          obj.set("quantity", data.quantity);
          obj.set("fileUrl", data.fileUrl);
          obj.set("extractedAt", new Date());
          obj.set("sourceRow", data.row);
          try {
            await obj.save();
          } catch (err) {
            console.error("保存数据失败:", { data, error: err.message });
            obj.set("error", err.message);
            await obj.save();
          }
        }
      }

      // Fill qtyMap from extracted or existing data
      const skus = Array.isArray(modal.skus) ? modal.skus : [modal.sku];
      setQtyMap((prev) => {
        const newQtyMap = { ...prev };
        extractedData.forEach(({ sku, quantity }) => {
          if (skus.includes(sku) && !savedQty[sku] && !newQtyMap[sku]) {
            newQtyMap[sku] = quantity.toString();
          }
        });
        return newQtyMap;
      });

      alert("✅ 数据已提取并填充");
    } catch (err) {
      console.error("数据提取失败:", err);
      alert(`数据提取失败：${err.message}`);
    }
  };

  const getRowStyle = (status) => {
    if (status === "已出库" || status === "异常") {
      return "bg-gray-50 text-gray-500";
    }
    return "";
  };

  const countryOptions = [
    "全部",
    ...new Set(list.map((r) => r.country).filter(Boolean)),
  ];

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

  const totalPages = Math.ceil(filteredList.length / rowsPerPage);
  const paginatedList = filteredList.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex justify-center gap-2 mt-4 text-sm">
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 hover:bg-gray-300"
        >
          上一页
        </button>
        <span>
          第 {currentPage} 页 / 共 {totalPages} 页
        </span>
        <button
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 hover:bg-gray-300"
        >
          下一页
        </button>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-blue-700 mb-6">🏷 仓库操作</h1>
      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">
            搜索 FBA 号
          </label>
          <input
            type="text"
            value={searchFba}
            onChange={(e) => setSearchFba(e.target.value)}
            placeholder="输入 FBA 号"
            className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">
            搜索 SKU
          </label>
          <input
            type="text"
            value={searchSku}
            onChange={(e) => setSearchSku(e.target.value)}
            placeholder="输入 SKU"
            className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">
            按国别筛选
          </label>
          <select
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {countryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">
            按提交月份筛选
          </label>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {getMonthOptions().map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading && <p className="text-gray-500 mb-4">加载中...</p>}
      {paginatedList.length === 0 && !loading && (
        <p className="text-gray-500 mb-4">暂无记录</p>
      )}
      {paginatedList
        .sort((a, b) => {
          const order = { 已提交: 0, 已出库: 1, 异常: 2 };
          return order[a.status] - order[b.status];
        })
        .map((r) => (
          <div
            key={r.id}
            onDoubleClick={() => openModal(r)}
            className={`flex justify-between items-center bg-white border rounded p-4 shadow-sm hover:shadow transition cursor-pointer mb-3 ${getRowStyle(
              r.status
            )}`}
          >
            <div className="text-sm space-y-1">
              <p className="font-medium">FBA号：{r.fba || '未定义'}</p>
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
            <div className="ml-4">
              <StatusBadge status={r.status} />
            </div>
          </div>
        ))}
      {renderPagination()}
      {modal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg w-[600px] max-h-[80vh] overflow-y-auto p-6 relative">
            <button
              onClick={() => setModal(null)}
              className="absolute top-3 right-3 text-gray-500 hover:text-black"
            >
              ×
            </button>
            <h2 className="text-lg font-bold mb-4">出库详情</h2>
            <div className="text-sm space-y-2">
              <p>
                <strong>FBA号：</strong>
                {modal.fba || '未定义'}
              </p>
              <p>
                <strong>国别：</strong>
                {modal.country}
              </p>
              <p>
                <strong>总箱数：</strong>
                {modal.cartonCount || modal.cartonCount === 0 ? modal.cartonCount : "-"}
              </p>
              <p>
                <strong>总体积：</strong>
                {modal.volume || modal.volume === 0 ? `${modal.volume.toFixed(2)} m³` : "-"}
              </p>
              <p>
                <strong>总重量：</strong>
                {modal.grossWeight || modal.grossWeight === 0 ? `${modal.grossWeight.toFixed(2)} kg` : "-"}
              </p>
              <p>
                <strong>SKU 出库数量：</strong>
              </p>
              {(Array.isArray(modal.skus) ? modal.skus : [modal.sku]).map(
                (sku) => (
                  <div key={sku} className="flex items-center gap-2 mb-1">
                    <span className="w-24">{sku}</span>
                    <input
                      type="number"
                      value={qtyMap[sku] || ""}
                      placeholder={`库存 ${stockMap[sku] || 0}`}
                      onChange={(e) =>
                        setQtyMap((q) => ({ ...q, [sku]: e.target.value }))
                      }
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      style={{ color: qtyMap[sku] ? "black" : "#999" }}
                    />
                    <button
                      onClick={() => saveQty(sku)}
                      className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                    >
                      保存
                    </button>
                  </div>
                )
              )}
              {modal.fileList?.length > 0 && (
                <div>
                  <p className="mt-2">
                    <strong>附件：</strong>
                  </p>
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
                        {f.name.toLowerCase().endsWith('.pdf') && (
                          <button
                            onClick={() => handlePrint(f.url, f.name)}
                            className="bg-green-600 text-white px-2 py-0.5 rounded text-xs hover:bg-green-700"
                          >
                            打开
                          </button>
                        )}
                        {(f.name.toLowerCase().endsWith('.xls') || 
                          f.name.toLowerCase().endsWith('.xlsx')) && (
                          <button
                            onClick={() => handleDataExtract(f.url)}
                            className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs hover:bg-blue-700"
                          >
                            数据提取
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-4 flex gap-3">
                <button
                  onClick={confirmOutbound}
                  className="bg-green-600 text-white px-4 py-2 rounded text-sm"
                >
                  确认出库
                </button>
                <button
                  onClick={markException}
                  className="bg-red-500 text-white px-4 py-2 rounded text-sm"
                >
                  异常
                </button>
                <button
                  onClick={forceComplete}
                  className="bg-gray-400 text-white px-4 py-2 rounded text-sm"
                >
                  手动结束
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                提交人：{modal.submittedBy}，时间：
                {formatDate(modal.submittedAt)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}