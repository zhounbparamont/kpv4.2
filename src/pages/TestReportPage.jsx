import React, { useState, useEffect } from "react";
import AV from "../leancloud";

export default function TestReportPage() {
  const [form, setForm] = useState({
    sku: "",
    countries: [],
    files: [],
    validFrom: "",
    validTo: "",
  });
  const [reports, setReports] = useState([]);
  const [filteredReports, setFilteredReports] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    fetchReports();
  }, []);

  useEffect(() => {
    let data = [...reports];
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      data = data.filter(r => r.sku.toLowerCase().includes(term));
    }
    if (countryFilter) {
      data = data.filter(r => r.validCountries.includes(countryFilter));
    }
    setFilteredReports(data);
    setCurrentPage(1);
  }, [reports, search, countryFilter]);

  const fetchReports = async () => {
    const q = new AV.Query("TestReport");
    q.descending("createdAt");
    q.limit(1000);
    const res = await q.find();
    setReports(res.map(r => ({ id: r.id, ...r.toJSON() })));
  };

  const handleSubmit = async () => {
    const { sku, countries, files, validFrom, validTo } = form;
    setError("");

    if (!sku || countries.length === 0 || !validFrom || !validTo || files.length === 0) {
      setError("请填写所有字段并至少上传一个文件");
      return;
    }

    try {
      const Report = AV.Object.extend("TestReport");
      const obj = new Report();
      obj.set("sku", sku);
      obj.set("validCountries", countries);
      obj.set("validFrom", new Date(validFrom));
      obj.set("validTo", new Date(validTo));

      const user = JSON.parse(localStorage.getItem("user") || "{}");
      obj.set("uploadedBy", user.username);
      obj.set("uploadedAt", new Date());

      const fileList = [];
      for (let file of form.files) {
        const avFile = new AV.File(file.name, file);
        await avFile.save();
        fileList.push({ name: file.name, url: avFile.url() });
      }
      obj.set("fileList", fileList);

      await obj.save();
      alert("上传成功");
      setForm({ sku: "", countries: [], files: [], validFrom: "", validTo: "" });
      fetchReports();
    } catch (err) {
      setError("上传失败：" + err.message);
    }
  };

  const daysLeft = (to) => {
    const d = new Date(to);
    const now = new Date();
    const diff = Math.floor((d - now) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? `${diff} 天后过期` : `已过期`;
  };

  const paged = filteredReports.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalPages = Math.ceil(filteredReports.length / pageSize);

  return (
    <div className="max-w-7xl mx-auto p-6 flex gap-8">
      {/* 左侧上传表单 */}
      <div className="w-[40%] bg-white p-6 rounded shadow space-y-4">
        <h2 className="text-lg font-bold text-blue-700">📤 上传测试报告</h2>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <input
          className="border px-3 py-2 w-full rounded"
          placeholder="SKU"
          value={form.sku}
          onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
        />
        <div>
          <label className="block text-sm mb-1">有效国家</label>
          <div className="flex flex-wrap gap-2">
            {["美国", "德国", "英国", "加拿大", "澳洲", "其他"].map(c => (
              <label key={c} className="text-sm">
                <input
                  type="checkbox"
                  checked={form.countries.includes(c)}
                  onChange={() =>
                    setForm(f => {
                      const set = new Set(f.countries);
                      set.has(c) ? set.delete(c) : set.add(c);
                      return { ...f, countries: Array.from(set) };
                    })
                  }
                />
                <span className="ml-1">{c}</span>
              </label>
            ))}
          </div>
        </div>
        <input type="file" multiple onChange={e => {
          const files = Array.from(e.target.files);
          if (files.length + form.files.length > 5) {
            setError("最多上传 5 个文件");
          } else {
            setForm(f => ({ ...f, files: [...f.files, ...files] }));
          }
        }} />
        <div className="flex gap-2">
          <input type="date" value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} className="border px-2 py-1 rounded w-full" />
          <input type="date" value={form.validTo} onChange={e => setForm(f => ({ ...f, validTo: e.target.value }))} className="border px-2 py-1 rounded w-full" />
        </div>
        <button onClick={handleSubmit} className="bg-blue-600 text-white w-full py-2 rounded hover:bg-blue-700">上传</button>
      </div>

      {/* 右侧列表展示 */}
      <div className="flex-1">
        <h2 className="text-lg font-bold text-blue-700 mb-4">📄 测试报告列表</h2>

        {/* 筛选工具栏 */}
        <div className="flex items-center gap-4 mb-4">
          <input
            placeholder="搜索 SKU"
            className="border px-3 py-1 rounded"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            value={countryFilter}
            onChange={e => setCountryFilter(e.target.value)}
            className="border px-3 py-1 rounded"
          >
            <option value="">全部国家</option>
            {["美国", "德国", "英国", "加拿大", "澳洲", "其他"].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          {paged.map(r => (
            <div key={r.id} className="bg-white border rounded shadow p-4 text-sm">
              <p><strong className="text-blue-800">SKU:</strong> <strong>{r.sku}</strong></p>
              <p><strong>有效国家:</strong> {r.validCountries.join(", ")}</p>
              <p><strong>有效期:</strong> {new Date(r.validFrom).toLocaleDateString()} ~ {new Date(r.validTo).toLocaleDateString()}</p>
              <p className="text-red-600 font-semibold mt-1">⏳ 距离失效：{daysLeft(r.validTo)}</p>
              <div className="mt-2">
                <strong>报告下载:</strong>
                <ul className="list-disc ml-5">
                  {r.fileList?.map((f, i) => (
                    <li key={i}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* 分页控制 */}
        {totalPages > 1 && (
          <div className="flex justify-center mt-6 gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setCurrentPage(p)}
                className={`px-3 py-1 rounded border ${p === currentPage ? "bg-blue-600 text-white" : "bg-white text-gray-700"}`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}