import React, { useState, useEffect } from "react";
import AV from "../leancloud";
import * as XLSX from "xlsx";

export default function ReworkManagePage() {
  const [stockList, setStockList] = useState([]);
  const [form, setForm] = useState({
    sku: "",
    quantity: "",
    reasonType: "产品问题",
    reasonText: "",
    countries: [],
    deadline: "",
    files: [],
  });
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [costConfirmedFilter, setCostConfirmedFilter] = useState("");
  const [error, setError] = useState("");
  const [editCost, setEditCost] = useState({});

  const pageSize = 10; // Changed from 20 to 10
  const [page, setPage] = useState(1);

  // List of countries for form and filter
  const countries = ["美国", "德国", "英国", "加拿大", "澳洲", "其他"];

  useEffect(() => {
    fetchStock();
    fetchList();
  }, []);

  const fetchStock = async () => {
    const q = new AV.Query("StockItem");
    q.limit(1000);
    const res = await q.find();
    setStockList(res.map((i) => ({ sku: i.get("sku"), quantity: i.get("quantity") })));
  };

  const fetchList = async () => {
    const q = new AV.Query("ReworkRequest");
    q.descending("createdAt");
    q.limit(1000);
    const res = await q.find();
    setList(
      res.map((i) => ({
        id: i.id,
        ...i.toJSON(),
        actualCostNumber: i.get("actualCostNumber") ?? (i.get("actualCost")?.value || null),
        completedAt: i.get("completedAt") || null,
        costConfirmed: i.get("costConfirmed") || false,
        costConfirmedBy: i.get("costConfirmedBy") || null,
      }))
    );
  };

  // Get unique months for month filter
  const uniqueMonths = [
    ...new Set(
      list.map((i) => new Date(i.submittedAt).toISOString().slice(0, 7))
    ),
  ].sort().reverse();

  // Filter and sort: completed records go to the bottom
  const filtered = list
    .filter((i) => {
      const m = monthFilter
        ? new Date(i.submittedAt).toISOString().slice(0, 7) === monthFilter
        : true;
      const s = search ? i.sku.includes(search) : true;
      const c = countryFilter ? i.countries.includes(countryFilter) : true;
      const cc = costConfirmedFilter === "confirmed"
        ? i.costConfirmed === true
        : costConfirmedFilter === "unconfirmed"
        ? i.costConfirmed === false
        : true;
      return m && s && c && cc;
    })
    .sort((a, b) => {
      if (a.status === "已完成" && b.status !== "已完成") return 1;
      if (a.status !== "已完成" && b.status === "已完成") return -1;
      return 0;
    });

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);

  const handleExport = () => {
    const exportData = filtered.map((i) => ({
      SKU: i.sku,
      数量: i.quantity,
      国家: i.countries?.join(", "),
      原因: i.reason,
      实际费用: i.actualCostNumber ? i.actualCostNumber.toFixed(2) : "",
      申请人: i.submittedBy,
      提交时间: new Date(i.submittedAt).toLocaleString(),
      状态: i.status || "处理中",
      完成时间: i.completedAt ? new Date(i.completedAt).toLocaleString() : "",
      费用确认: i.costConfirmed ? `由 ${i.costConfirmedBy} 确认` : "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "返工记录");
    XLSX.writeFile(wb, `返工记录_${monthFilter || "全部"}.xlsx`);
  };

  const updateCost = async (id, value) => {
    try {
      const num = parseFloat(value);
      if (isNaN(num)) return alert("请输入数字");
      if (num.toString().split(".")[1]?.length > 2) return alert("小数点后最多两位");
      const obj = AV.Object.createWithoutData("ReworkRequest", id);
      obj.set("actualCostNumber", num);
      await obj.save();
      fetchList();
      setEditCost((e) => ({ ...e, [id]: false }));
    } catch (err) {
      alert("保存失败: " + (err.message || "未知错误"));
    }
  };

  const updateStatus = async (id, newStatus) => {
    try {
      const obj = AV.Object.createWithoutData("ReworkRequest", id);
      obj.set("status", newStatus);
      if (newStatus === "已完成") {
        obj.set("completedAt", new Date());
      } else {
        obj.unset("completedAt");
      }
      await obj.save();
      fetchList();
    } catch (err) {
      alert("状态更新失败: " + (err.message || "未知错误"));
    }
  };

  const confirmCost = async (id) => {
    try {
      const user = AV.User.current();
      if (!user) return alert("请先登录");
      const obj = AV.Object.createWithoutData("ReworkRequest", id);
      obj.set("costConfirmed", true);
      obj.set("costConfirmedBy", user.get("username") || "Unknown");
      await obj.save();
      fetchList();
    } catch (err) {
      alert("费用确认失败: " + (err.message || "未知错误"));
    }
  };

  const handleSubmit = async () => {
    try {
      if (!form.sku) return setError("请选择 SKU");
      if (!form.quantity || parseInt(form.quantity) <= 0) return setError("请输入有效的返工数量");
      if (form.reasonType === "其他" && !form.reasonText) return setError("请填写其他原因");
      if (!form.deadline) return setError("请选择最晚完工日期");
      if (!form.countries.length) return setError("请选择至少一个国家");

      const user = AV.User.current();
      if (!user) return setError("请先登录");

      const ReworkRequest = AV.Object.extend("ReworkRequest");
      const request = new ReworkRequest();
      request.set("sku", form.sku);
      request.set("quantity", parseInt(form.quantity));
      request.set("reason", form.reasonType === "其他" ? form.reasonText : form.reasonType);
      request.set("countries", form.countries);
      request.set("deadline", new Date(form.deadline));
      request.set("submittedBy", user.get("username") || "Unknown");
      request.set("submittedAt", new Date());
      request.set("status", "处理中");

      await request.save();

      setForm({
        sku: "",
        quantity: "",
        reasonType: "产品问题",
        reasonText: "",
        countries: [],
        deadline: "",
        files: [],
      });
      setError("");

      fetchList();
    } catch (err) {
      setError("提交失败: " + (err.message || "未知错误"));
    }
  };

  const daysLeft = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((d - now) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? `${diff} 天` : "已超期";
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-blue-700 mb-6">🔧 库内返工管理</h1>

      {/* 筛选 + 导出 */}
      <div className="flex gap-4 items-center mb-4 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 SKU"
          className="border px-3 py-1 rounded"
        />
        <button
          onClick={handleExport}
          className="bg-green-600 text-white px-4 py-1 rounded hover:bg-green-700 text-sm"
        >
          导出当前月
        </button>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="border px-3 py-1 rounded"
        >
          <option value="">选择月份</option>
          {uniqueMonths.map((month) => (
            <option key={month} value={month}>
              {month}
            </option>
          ))}
        </select>
        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="border px-3 py-1 rounded"
        >
          <option value="">选择国家</option>
          {countries.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
        <select
          value={costConfirmedFilter}
          onChange={(e) => setCostConfirmedFilter(e.target.value)}
          className="border px-3 py-1 rounded"
        >
          <option value="">全部</option>
          <option value="confirmed">费用已确认</option>
          <option value="unconfirmed">费用未确认</option>
        </select>
      </div>

      {/* 表单和列表 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 bg-white rounded p-4 shadow space-y-3">
          <h2 className="text-blue-700 font-semibold">📥 提交返工需求</h2>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <select
            name="sku"
            value={form.sku}
            onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            className="w-full border px-3 py-2 rounded"
          >
            <option value="">选择 SKU</option>
            {stockList.map((s) => (
              <option key={s.sku} value={s.sku}>
                {s.sku}（库存 {s.quantity}）
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="返工数量"
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            className="w-full border px-3 py-2 rounded"
          />
          <div className="space-x-4">
            {["产品问题", "特定国家需求", "其他"].map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  value={t}
                  name="reasonType"
                  checked={form.reasonType === t}
                  onChange={(e) => setForm((f) => ({ ...f, reasonType: e.target.value }))}
                />
                <span className="ml-1">{t}</span>
              </label>
            ))}
          </div>
          {form.reasonType === "其他" && (
            <input
              value={form.reasonText}
              onChange={(e) => setForm((f) => ({ ...f, reasonText: e.target.value }))}
              placeholder="填写原因"
              className="w-full border px-3 py-2 rounded"
            />
          )}
          <div className="text-sm">需求国家：</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {countries.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={form.countries.includes(c)}
                  onChange={() => {
                    const set = new Set(form.countries);
                    set.has(c) ? set.delete(c) : set.add(c);
                    setForm((f) => ({ ...f, countries: Array.from(set) }));
                  }}
                />{" "}
                {c}
              </label>
            ))}
          </div>
          <div>
            <label className="text-sm">最晚完工日期</label>
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <button
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            onClick={handleSubmit}
          >
            提交
          </button>
        </div>

        <div className="md:col-span-2 space-y-4">
          {paged.map((r) => (
            <div
              key={r.id}
              className={`bg-white rounded border shadow p-4 text-sm relative ${
                r.costConfirmed === true ? "opacity-50 bg-gray-100" : ""
              }`}
            >
              <span
                className={`absolute top-2 right-2 text-xs px-2 py-1 rounded ${
                  r.status === "已完成"
                    ? "bg-green-200 text-green-800"
                    : r.status === "异常"
                    ? "bg-red-200 text-red-800"
                    : "bg-blue-200 text-blue-800"
                }`}
              >
                {r.status || "处理中"}
              </span>
              <p>
                <strong className="text-blue-800">SKU:</strong> {r.sku}
              </p>
              <p>数量: {r.quantity}</p>
              <p>国家: {r.countries?.join(", ") || "-"}</p>
              <p>原因: {r.reason}</p>
              <p>
                最晚完工: {new Date(r.deadline).toLocaleDateString()}（{daysLeft(r.deadline)}）
              </p>
              <p>
                提交人: {r.submittedBy}，时间: {new Date(r.submittedAt).toLocaleString()}
              </p>
              <div className="flex gap-2 items-center mt-1">
                <span>实际费用（RMB）:</span>
                {editCost[r.id] ? (
                  <>
                    <input
                      data-id={r.id}
                      defaultValue={r.actualCostNumber ? r.actualCostNumber.toFixed(2) : ""}
                      type="number"
                      step="0.01"
                      className="border px-2 py-1 rounded w-24"
                      autoFocus
                      onBlur={(e) => updateCost(r.id, e.target.value)}
                    />
                    <button
                      onClick={() =>
                        updateCost(r.id, document.querySelector(`[data-id="${r.id}"]`).value)
                      }
                      className="text-blue-600 hover:underline text-xs"
                    >
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <span>{r.actualCostNumber ? r.actualCostNumber.toFixed(2) : "-"}</span>
                    <button
                      onClick={() => setEditCost((e) => ({ ...e, [r.id]: true }))}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      修改
                    </button>
                  </>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => updateStatus(r.id, "已完成")}
                  className="text-green-600 hover:underline text-xs"
                >
                  标记为已完成
                </button>
                <button
                  onClick={() => updateStatus(r.id, "异常")}
                  className="text-red-600 hover:underline text-xs"
                >
                  标记为异常
                </button>
                <button
                  onClick={() => updateStatus(r.id, "处理中")}
                  className="text-blue-600 hover:underline text-xs"
                >
                  恢复处理中
                </button>
                <button
                  onClick={() => confirmCost(r.id)}
                  className="text-purple-600 hover:underline text-xs"
                >
                  费用确认
                </button>
              </div>
              {r.status === "已完成" && r.completedAt && (
                <p
                  className={`absolute right-2 text-xs text-gray-600 ${
                    r.costConfirmed ? "bottom-8" : "bottom-2"
                  }`}
                >
                  完成时间: {new Date(r.completedAt).toLocaleDateString()}
                </p>
              )}
              {r.costConfirmed && (
                <div
                  className="absolute bottom-2 right-2 bg-green-600 text-white text-xs px-2 py-1 rounded"
                >
                  费用确认 by {r.costConfirmedBy}
                </div>
              )}
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex gap-2 justify-center pt-4">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1 border rounded ${
                    p === page ? "bg-blue-600 text-white" : "bg-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}