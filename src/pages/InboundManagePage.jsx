```javascript
import { useEffect, useState, useCallback } from "react";
import AV from "leancloud-storage";
import { useNavigate } from "react-router-dom";
import { debounce } from "lodash";
import { jsPDF } from "jspdf";

export default function InboundManagePage() {
  const [stockList, setStockList] = useState([]);
  const [inbounds, setInbounds] = useState([]);
  const [form, setForm] = useState({
    sku: "",
    quantity: "",
    boxCount: "",
    cubicMeters: "",
    status: "待入库",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 生成入库单号：IN-YYYYMMDD-XXXX
  const generateInboundId = () => {
    const date = new Date().toISOString().slice(0, 10).replace(/-g/, "");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `IN-${date}-${random}`;
  };

  // 获取库存（SKU 列表）
  const fetchStock = useCallback(
    debounce(async () => {
      try {
        const q = new AV.Query("StockItem");
        q.greaterThan("quantity", 0);
        const res = await q.find();
        setStockList(
          res.map(item => ({
            sku: item.get("sku"),
            quantity: item.get("quantity"),
          }))
        );
      } catch (e) {
        console.error("获取库存失败:", e);
        setError("加载库存失败");
      }
    }, 1000),
    []
  );

  // 获取入库记录（分页）
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const fetchInbounds = useCallback(
    debounce(async () => {
      const cachedData = localStorage.getItem("inboundRequests");
      if (cachedData) {
        setInbounds(JSON.parse(cachedData));
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const user = AV.User.current();
        if (!user) {
          setError("请先登录");
          navigate("/login");
          return;
        }
        const q = new AV.Query("InboundRequest");
        q.descending("submittedAt");
        q.limit(pageSize);
        q.skip(page * pageSize);
        const res = await q.find();
        const data = res.map(item => item.toJSON());
        setInbounds(data);
        localStorage.setItem("inboundRequests", JSON.stringify(data));
      } catch (e) {
        console.error("获取入库记录失败:", e);
        if (e.code === 429) {
          const retryAfter = e.rawResponse?.headers?.["retry-after"];
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          setError(`请求过于频繁，将在 ${waitTime / 1000} 秒后重试`);
          setTimeout(() => fetchInbounds(), waitTime);
        } else {
          setError("加载入库记录失败");
        }
      } finally {
        setLoading(false);
      }
    }, 1000),
    [navigate, page]
  );

  useEffect(() => {
    const user = AV.User.current();
    if (!user) {
      navigate("/login");
      return;
    }
    fetchStock();
    fetchInbounds();
    return () => {
      fetchStock.cancel();
      fetchInbounds.cancel();
    };
  }, [fetchStock, fetchInbounds, navigate]);

  // 提交入库记录
  const handleSubmit = async () => {
    if (!form.sku || !form.quantity || !form.boxCount || !form.cubicMeters) {
      setError("所有字段均为必填项");
      return;
    }
    const quantity = Number(form.quantity);
    const boxCount = Number(form.boxCount);
    const cubicMeters = Number(form.cubicMeters);
    if (
      isNaN(quantity) ||
      quantity <= 0 ||
      isNaN(boxCount) ||
      boxCount <= 0 ||
      isNaN(cubicMeters) ||
      cubicMeters <= 0
    ) {
      setError("数量、箱数和立方数必须是大于 0 的有效数字");
      return;
    }
    try {
      const user = AV.User.current();
      if (!user) {
        setError("请先登录");
        navigate("/login");
        return;
      }
      const Inbound = AV.Object.extend("InboundRequest");
      const obj = new Inbound();
      obj.set("inboundId", generateInboundId());
      obj.set("sku", form.sku);
      obj.set("quantity", quantity);
      obj.set("boxCount", boxCount);
      obj.set("cubicMeters", cubicMeters);
      obj.set("status", form.status);
      obj.set("submittedBy", user.getUsername());
      obj.set("submittedAt", new Date());
      const acl = new AV.ACL();
      acl.setPublicReadAccess(true);
      acl.setWriteAccess(user, true);
      obj.setACL(acl);
      await obj.save();
      setForm({
        sku: "",
        quantity: "",
        boxCount: "",
        cubicMeters: "",
        status: "待入库",
      });
      setError("");
      localStorage.removeItem("inboundRequests");
      fetchInbounds();
      alert("入库记录提交成功");
    } catch (e) {
      console.error("提交失败:", e);
      if (e.code === 429) {
        setError("请求过于频繁，请稍后再试");
      } else {
        setError(`提交失败: ${e.message}`);
      }
    }
  };

  // 生成进仓单 PDF
  const generatePDF = async inbound => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text("进仓单", 10, 10);
      doc.setFontSize(12);
      doc.text(`入库单号: ${inbound.inboundId}`, 10, 20);
      doc.text(`SKU: ${inbound.sku}`, 10, 30);
      doc.text(`数量: ${inbound.quantity}`, 10, 40);
      doc.text(`箱数: ${inbound.boxCount}`, 10, 50);
      doc.text(`立方数: ${inbound.cubicMeters} m³`, 10, 60);
      doc.text(`状态: ${inbound.status}`, 10, 70);
      doc.text(`提交人: ${inbound.submittedBy}`, 10, 80);
      doc.text(`提交时间: ${new Date(inbound.submittedAt).toLocaleString()}`, 10, 90);

      const pdfBlob = doc.output("blob");
      const pdfFile = new File([pdfBlob], `${inbound.inboundId}.pdf`, {
        type: "application/pdf",
      });
      const avFile = new AV.File(pdfFile.name, pdfFile);
      await avFile.save();
      const inboundObj = AV.Object.createWithoutData("InboundRequest", inbound.objectId);
      inboundObj.set("fileList", [{ name: pdfFile.name, url: avFile.url() }]);
      await inboundObj.save();
      localStorage.removeItem("inboundRequests");
      fetchInbounds();
      alert("进仓单生成成功");
    } catch (e) {
      console.error("生成进仓单失败:", e);
      setError(`生成进仓单失败: ${e.message}`);
    }
  };

  // 删除入库记录（仅限待入库状态）
  const deleteInbound = async (id, inboundId) => {
    if (!window.confirm(`确定要删除入库单号: ${inboundId} 的记录吗？`)) return;
    try {
      const user = AV.User.current();
      if (!user) {
        setError("请先登录");
        navigate("/login");
        return;
      }
      const obj = AV.Object.createWithoutData("InboundRequest", id);
      await obj.destroy();
      localStorage.removeItem("inboundRequests");
      fetchInbounds();
      alert("删除成功");
    } catch (e) {
      console.error("删除失败:", e);
      setError(`删除失败: ${e.message}`);
    }
  };

  // 分页控制
  const handleNextPage = () => setPage(prev => prev + 1);
  const handlePrevPage = () => setPage(prev => Math.max(0, prev - 1));

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-blue-700 mb-6">📥 入库管理</h1>
      <div className="grid md:grid-cols-5 gap-4 mb-6 text-sm">
        <select
          value={form.sku}
          onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
          className="border rounded px-3 py-4"
        >
          <option value="">请选择 SKU</option>
          {stockList.map(s => (
            <option key={s.sku} value={s.sku}>
              {s.sku}（库存 {s.quantity}）
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="数量"
          value={form.quantity}
          onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
          className="border rounded px-3 py-4"
        />
        <input
          type="number"
          placeholder="箱数"
          value={form.boxCount}
          onChange={e => setForm(f => ({ ...f, boxCount: e.target.value }))}
          className="border rounded px-3 py-4"
        />
        <input
          type="number"
          placeholder="立方数 (m³)"
          value={form.cubicMeters}
          onChange={e => setForm(f => ({ ...f, cubicMeters: e.target.value }))}
          className="border rounded px-3 py-4"
        />
        <select
          value={form.status}
          onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
          className="border rounded px-3 py-4"
        >
          <option value="待入库">待入库</option>
          <option value="已入库">已入库</option>
          <option value="异常">异常</option>
        </select>
      </div>
      {error && <div className="text-red-600 mb-4">{error}</div>}
      <button
        onClick={handleSubmit}
        className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition mb-8"
      >
        提交入库
      </button>
      {loading && <p className="text-gray-500 text-center py-4">加载中...</p>}
      <h2 className="text-lg font-semibold text-gray-800 mb-4">
        📋 已提交的入库记录
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border border-gray-200 rounded shadow-sm text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 border-b text-left">操作</th>
              <th className="px-4 py-2 border-b text-left">入库单号</th>
              <th className="px-4 py-2 border-b text-left">SKU</th>
              <th className="px-4 py-2 border-b text-left">数量</th>
              <th className="px-4 py-2 border-b text-left">箱数</th>
              <th className="px-4 py-2 border-b text-left">立方数</th>
              <th className="px-4 py-2 border-b text-left">状态</th>
              <th className="px-4 py-2 border-b text-left">进仓单</th>
              <th className="px-4 py-2 border-b text-left">提交人</th>
              <th className="px-4 py-2 border-b text-left">提交时间</th>
            </tr>
          </thead>
          <tbody>
            {!loading && inbounds.length === 0 && (
              <tr>
                <td colSpan="10" className="text-center py-6 text-gray-500">
                  暂无入库记录
                </td>
              </tr>
            )}
            {!loading &&
              inbounds.map(i => (
                <tr key={i.objectId} className="hover:bg-gray-50">
                  <td className="px-4 py-2 border-b space-x-2 whitespace-nowrap">
                    {i.status === "待入库" ? (
                      <>
                        <button
                          onClick={() => generatePDF(i)}
                          className="text-blue-600 hover:underline"
                          title="生成进仓单 PDF"
                        >
                          生成进仓单
                        </button>
                        <button
                          onClick={() => deleteInbound(i.objectId, i.inboundId)}
                          className="text-red-600 hover:underline"
                          title="删除此条入库记录"
                        >
                          删除
                        </button>
                      </>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 border-b">{i.inboundId}</td>
                  <td className="px-4 py-2 border-b">{i.sku}</td>
                  <td className="px-4 py-2 border-b">{i.quantity}</td>
                  <td className="px-4 py-2 border-b">{i.boxCount}</td>
                  <td className="px-4 py-2 border-b">{i.cubicMeters} m³</td>
                  <td className="px-4 py-2 border-b">{i.status}</td>
                  <td className="px-4 py-2 border-b">
                    {i.fileList ? (
                      i.fileList.map((f, index) => (
                        <div key={index}>
                          <a
                            href={f.url}
                            target="_blank"
                            className="text-blue-600 hover:underline"
                            rel="noopener noreferrer"
                          >
                            {f.name}
                          </a>
                        </div>
                      ))
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-2 border-b">{i.submittedBy}</td>
                  <td className="px-4 py-2 border-b">
                    {new Date(i.submittedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between mt-4">
        <button
          onClick={handlePrevPage}
          disabled={page === 0}
          className="bg-gray-300 px-4 py-2 rounded disabled:opacity-50"
        >
          上一页
        </button>
        <span>第 {page + 1} 页</span>
        <button
          onClick={handleNextPage}
          className="bg-gray-300 px-4 py-2 rounded"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
```