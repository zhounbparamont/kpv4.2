import React, { useEffect, useState } from "react";
import AV from "../leancloud";
import { useNavigate } from "react-router-dom";
import * as XLSX from 'xlsx';

// 文件图标辅助函数
const getFileIcon = (filename) => {
  if (!filename) return '📁';
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📄';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['xls','xlsx'].includes(ext)) return '📊';
  if (['jpg','jpeg','png','gif','bmp'].includes(ext)) return '🖼️';
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

// 时间间隔格式化
const formatDuration = (ms) => {
  if (!ms || ms < 0) return "-";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return `${days}天`;
};

// 计算节点停留时间
const calculateStageDuration = (project, stage, stages, stageOrder) => {
  const stageIndex = stageOrder.indexOf(stage);
  const stageData = stages[stage];
  const startTime = stageIndex === 0
    ? new Date(project.createdAt)
    : new Date(stages[stageOrder[stageIndex - 1]]?.confirmedAt);
  const endTime = stageData?.status === "已确认"
    ? new Date(stageData.confirmedAt)
    : new Date();
  if (!startTime || isNaN(startTime.getTime()) || !endTime || isNaN(endTime.getTime())) return "-";
  return formatDuration(endTime - startTime);
};

// 计算项目总停留时间
const calculateTotalDuration = (project, stages, isAbnormal, stageOrder) => {
  const startTime = new Date(project.createdAt);
  let endTime;
  if (isAbnormal) {
    endTime = new Date(
      stageOrder
        .filter(s => stages[s]?.status === "已确认")
        .map(s => stages[s].confirmedAt)
        .sort((a, b) => new Date(b) - new Date(a))[0] || project.createdAt
    );
  } else if (stageOrder.every(s => stages[s]?.status === "已确认")) {
    endTime = new Date(stages[stageOrder[stageOrder.length - 1]].confirmedAt);
  } else {
    endTime = new Date();
  }
  if (!startTime || isNaN(startTime.getTime()) || !endTime || isNaN(endTime.getTime())) {
    return { days: 0, formatted: "-" };
  }
  const ms = endTime - startTime;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return { days, formatted: formatDuration(ms) };
};

// 计算项目状态
const getProjectStatus = (stages, isAbnormal) => {
  if (isAbnormal) return "异常";
  const stageOrder = ["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"];
  const allConfirmed = stageOrder.every(stage => stages[stage]?.status === "已确认");
  return allConfirmed ? "开发完成" : "开发中";
};

// 状态徽章组件
function StatusBadge({ status }) {
  const base = "px-2 py-0.5 text-xs rounded-full font-medium";
  const map = {
    "开发中": "bg-yellow-100 text-yellow-800",
    "开发完成": "bg-green-100 text-green-800",
    "异常": "bg-red-100 text-red-800",
    "待确认": "bg-yellow-100 text-yellow-800",
    "已确认": "bg-green-100 text-green-800",
  };
  return <span className={`${base} ${map[status] || "bg-gray-100 text-gray-800"}`}>{status}</span>;
}

// 总停留时间徽章组件
function TotalDurationBadge({ days, formatted }) {
  const base = "px-2 py-1 rounded-full text-sm font-medium";
  const style = days <= 30
    ? "bg-green-100 text-green-800"
    : days <= 60
    ? "bg-yellow-100 text-yellow-800"
    : "bg-red-100 text-red-800";
  return <span className={`${base} ${style}`}>{formatted}</span>;
}

// 通用区块标题
function Section({ title, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-blue-800 mb-4 border-b pb-2">{title}</h2>
      {children || <p className="text-sm text-gray-400 italic">暂无内容</p>}
    </div>
  );
}

export default function ProductDevelopmentPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  const [form, setForm] = useState({
    name: "",
    stage: "立项",
    files: {}
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalProject, setModalProject] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterCreatedBy, setFilterCreatedBy] = useState("全部");
  const [filterMonth, setFilterMonth] = useState("全部");
  const [filterCurrentStage, setFilterCurrentStage] = useState("全部");
  const [createdByOptions, setCreatedByOptions] = useState(["全部"]);
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;

  useEffect(() => {
    document.title = "Kunpeng System";
    return () => {
      document.title = "Order System";
    };
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    setError("");
    try {
      const q = new AV.Query("ProductDevelopment");
      q.descending("createdAt");
      q.limit(100);
      const results = await q.find();
      const data = results.map(item => {
        const projectData = { id: item.id, ...item.toJSON() };
        const stageOrder = ["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"];
        const stages = projectData.stages || {};
        stageOrder.forEach(stage => {
          if (!stages[stage]) {
            stages[stage] = { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] };
          }
        });
        projectData.stages = stages;
        return projectData;
      });
      setProjects(data);
      setFilteredProjects(data);
      const uniqueCreatedBy = [
        "全部",
        ...new Set(data.map(item => item.createdBy).filter(Boolean)),
      ];
      setCreatedByOptions(uniqueCreatedBy);
    } catch (e) {
      console.error("获取项目失败", e);
      setError(e.code === 404 ? 
        "ProductDevelopment 类不存在，请先在 LeanCloud 创建或保存一个项目" : 
        `获取项目失败：${e.message || '请检查网络或联系管理员'}`);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    let result = [...projects];
    if (filterCreatedBy !== "全部") {
      result = result.filter(item => item.createdBy === filterCreatedBy);
    }
    if (filterMonth !== "全部") {
      result = result.filter(item => {
        if (!item.createdAt) return false;
        const date = new Date(item.createdAt);
        const monthYear = `${date.getFullYear()}-${date.getMonth() + 1}`;
        return monthYear === filterMonth;
      });
    }
    if (filterCurrentStage !== "全部") {
      result = result.filter(item => item.currentStage === filterCurrentStage);
    }
    setFilteredProjects(result);
    setCurrentPage(1);
  }, [projects, filterCreatedBy, filterMonth, filterCurrentStage]);

  const handleChange = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    setError("");
  };

  const handleFileChange = (e, stage) => {
    const files = Array.from(e.target.files).slice(0, 5 - (form.files[stage]?.length || 0));
    setForm(f => ({
      ...f,
      files: { ...f.files, [stage]: [...(f.files[stage] || []), ...files] }
    }));
    e.target.value = null;
  };

  const removeFile = (stage, idx) => {
    setForm(f => ({
      ...f,
      files: { ...f.files, [stage]: f.files[stage].filter((_, i) => i !== idx) }
    }));
  };

  const handleInitiate = async () => {
    if (!form.name.trim()) {
      setError("产品名称不能为空");
      return;
    }
    setLoading(true);
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const Project = AV.Object.extend("ProductDevelopment");
      const project = new Project();
      project.set("name", form.name.trim());
      project.set("currentStage", "立项");
      project.set("stages", {
        "立项": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] },
        "产品方案": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] },
        "设计": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] },
        "定稿": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] },
        "样品确认": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] },
        "采购核价": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] },
        "检测报告": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] },
        "运营派单": { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] }
      });
      project.set("createdBy", user.username || "未知");
      project.set("isAbnormal", false);
      await project.save();
      setForm({ name: "", stage: "立项", files: {} });
      setShowCreateModal(false);
      fetchProjects();
    } catch (e) {
      console.error("发起失败", e);
      setError(`发起失败：${e.message || '请检查网络或联系管理员'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (stage) => {
    setModalLoading(true);
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      const project = modalProject;
      if (!project) {
        setError("未选择项目");
        return;
      }
      if (project.isAbnormal) {
        setError("项目已停止开发，无法确认");
        return;
      }
      const stages = { ...project.stages };
      if (!stages[stage]) {
        stages[stage] = { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] };
      }
      stages[stage].status = "已确认";
      stages[stage].confirmedBy = user.username || "未知";
      stages[stage].confirmedAt = new Date();
      if (form.files[stage]?.length) {
        const fileList = [];
        for (let f of form.files[stage]) {
          const af = new AV.File(f.name, f);
          await af.save();
          fileList.push({ name: f.name, url: af.url() });
        }
        stages[stage].files = fileList;
      }
      const obj = AV.Object.createWithoutData("ProductDevelopment", project.id);
      obj.set("stages", stages);
      const stageOrder = ["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"];
      const currentIndex = stageOrder.indexOf(stage);
      const nextStage = currentIndex < stageOrder.length - 1 ? stageOrder[currentIndex + 1] : stage;
      obj.set("currentStage", nextStage);
      await obj.save();
      if (stage === "运营派单") {
        navigate("/dispatch", { state: { name: project.name } });
      }
      setForm(f => ({ ...f, files: { ...f.files, [stage]: [] } }));
      setModalProject({ ...project, stages, currentStage: nextStage });
      fetchProjects();
    } catch (e) {
      console.error("确认失败", e);
      setError(`确认失败：${e.message || '请检查网络或联系管理员'}`);
    } finally {
      setModalLoading(false);
    }
  };

  const handleStopDevelopment = async () => {
    setModalLoading(true);
    try {
      const project = modalProject;
      if (!project) {
        setError("未选择项目");
        return;
      }
      const obj = AV.Object.createWithoutData("ProductDevelopment", project.id);
      obj.set("isAbnormal", true);
      await obj.save();
      fetchProjects();
      closeModal();
    } catch (e) {
      console.error("停止开发失败", e);
      setError(`停止开发失败：${e.message || '请检查网络或联系管理员'}`);
    } finally {
      setModalLoading(false);
    }
  };

  const openModal = project => {
    const stageOrder = ["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"];
    const stages = { ...project.stages };
    stageOrder.forEach(stage => {
      if (!stages[stage]) {
        stages[stage] = { status: "待确认", confirmedBy: "", confirmedAt: null, files: [] };
      }
    });
    const updatedProject = { ...project, stages };
    console.log('Opening Modal with Project:', updatedProject);
    setModalProject(updatedProject);
    setShowModal(true);
    setForm({ name: "", stage: project.currentStage, files: {} });
  };

  const closeModal = () => {
    setShowModal(false);
    setModalProject(null);
    setError("");
    setForm({ name: "", stage: "立项", files: {} });
  };

  const openCreateModal = () => {
    setShowCreateModal(true);
    setForm({ name: "", stage: "立项", files: {} });
    setError("");
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setForm({ name: "", stage: "立项", files: {} });
    setError("");
  };

  const handleExport = () => {
    try {
      if (filteredProjects.length === 0) {
        setError("没有数据可导出");
        return;
      }
      const stageOrder = ["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"];
      const data = filteredProjects.map(item => ({
        产品名称: item.name || "-",
        当前节点: item.currentStage || "-",
        状态: getProjectStatus(item.stages, item.isAbnormal),
        发起人: item.createdBy || "-",
        创建时间: item.createdAt ? formatDate(item.createdAt) : "-",
        总停留时间: calculateTotalDuration(item, item.stages, item.isAbnormal, stageOrder).formatted,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ProductDevelopment");
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ProductDevelopment.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("导出失败", e);
      setError("导出失败，请检查数据或网络");
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

  const paginate = () => {
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    return filteredProjects.slice(start, end);
  };

  const renderPagination = () => {
    const totalPages = Math.ceil(filteredProjects.length / rowsPerPage);
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

  const getRowBackground = (stage) => {
    const map = {
      "立项": "bg-yellow-50",
      "产品方案": "bg-blue-50",
      "设计": "bg-blue-50",
      "定稿": "bg-purple-50",
      "样品确认": "bg-purple-50",
      "采购核价": "bg-green-50",
      "检测报告": "bg-cyan-50",
      "运营派单": "bg-orange-50",
    };
    return map[stage] || "bg-white";
  };

  return (
    <div className="p-6 w-full min-h-screen bg-gray-100 rounded shadow">
      <h1 className="text-3xl font-bold text-blue-800 mb-8 border-b pb-2">📋 产品开发</h1>
      <div className="w-full bg-white p-6 border border-gray-300 rounded">
        <div className="flex justify-end gap-4 mb-4">
          <button
            onClick={openCreateModal}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 shadow-sm"
          >
            + 新建项目
          </button>
          <button
            onClick={handleExport}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 shadow-sm"
          >
            导出 Excel
          </button>
        </div>
        <div className="flex flex-wrap gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">按发起人筛选</label>
            <select
              value={filterCreatedBy}
              onChange={e => setFilterCreatedBy(e.target.value)}
              className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {createdByOptions.map(p => (
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
            <label className="block text-sm font-medium mb-1 text-gray-700">按当前节点筛选</label>
            <select
              value={filterCurrentStage}
              onChange={e => setFilterCurrentStage(e.target.value)}
              className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {["全部", "立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}
        {loading && <p className="text-gray-500 mb-4 text-sm">加载中...</p>}
        <Section title="📋 项目列表（双击查看）">
          <div className="overflow-x-auto">
            <table className="w-full border rounded text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 border-b text-left">产品名称</th>
                  <th className="px-4 py-2 border-b text-left">当前节点</th>
                  <th className="px-4 py-2 border-b text-left">状态</th>
                  <th className="px-4 py-2 border-b text-left">发起人</th>
                  <th className="px-4 py-2 border-b text-left">创建时间</th>
                  <th className="px-4 py-2 border-b text-left">总停留时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-left px-4 py-4 text-gray-500">暂无项目记录</td>
                  </tr>
                ) : (
                  paginate().map(p => (
                    <tr
                      key={p.id}
                      className={`hover:bg-gray-50 cursor-pointer ${getRowBackground(p.currentStage)}`}
                      onDoubleClick={() => openModal(p)}
                    >
                      <td className="px-4 py-2 border-b text-left">{p.name}</td>
                      <td className="px-4 py-2 border-b text-left">{p.currentStage}</td>
                      <td className="px-4 py-2 border-b text-left">
                        <StatusBadge status={getProjectStatus(p.stages, p.isAbnormal)} />
                      </td>
                      <td className="px-4 py-2 border-b text-left">{p.createdBy}</td>
                      <td className="px-4 py-2 border-b text-left">{formatDate(p.createdAt)}</td>
                      <td className="px-4 py-2 border-b text-left">
                        <TotalDurationBadge
                          days={calculateTotalDuration(p, p.stages, p.isAbnormal, ["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"]).days}
                          formatted={calculateTotalDuration(p, p.stages, p.isAbnormal, ["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"]).formatted}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {renderPagination()}
        </Section>
      </div>
      {showModal && modalProject && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg w-[900px] max-h-[80vh] overflow-y-auto p-6 relative">
            <button onClick={closeModal} className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-xl">×</button>
            <h3 className="text-xl font-semibold mb-4">项目详情</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <p><strong>产品名称：</strong>{modalProject.name}</p>
                <p><strong>当前节点：</strong>{modalProject.currentStage}</p>
                <p><strong>状态：</strong><StatusBadge status={getProjectStatus(modalProject.stages, modalProject.isAbnormal)} /></p>
                <p><strong>发起人：</strong>{modalProject.createdBy}</p>
                <p><strong>创建时间：</strong>{formatDate(modalProject.createdAt)}</p>
              </div>
              {!modalProject.isAbnormal && getProjectStatus(modalProject.stages, modalProject.isAbnormal) === "开发中" && (
                <button
                  onClick={handleStopDevelopment}
                  disabled={modalLoading}
                  className={`w-[150px] mx-auto bg-red-600 text-white py-1.5 rounded text-sm ${
                    modalLoading ? "opacity-50 cursor-not-allowed" : "hover:bg-red-700"
                  }`}
                >
                  {modalLoading ? "处理中..." : "停止开发"}
                </button>
              )}
              <h4 className="font-semibold mt-4 text-lg">开发流程</h4>
              <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
                {["立项", "产品方案", "设计", "定稿", "样品确认", "采购核价", "检测报告", "运营派单"].map((stage, index, arr) => (
                  <div key={stage} className="flex items-center">
                    <div className={`p-4 rounded-lg shadow-sm w-48 flex-shrink-0 ${
                      modalProject.stages[stage]?.status === "已确认"
                        ? "bg-green-100 border border-green-500"
                        : "bg-yellow-100 border border-yellow-500"
                    }`}>
                      <p className="font-semibold text-sm mb-2">{stage} <StatusBadge status={modalProject.stages[stage]?.status || "待确认"} /></p>
                      <div className="text-xs space-y-1">
                        <p><strong>停留时间：</strong>{calculateStageDuration(modalProject, stage, modalProject.stages, arr)}</p>
                        <p><strong>确认人：</strong>{modalProject.stages[stage]?.confirmedBy || "未确认"}</p>
                        <p><strong>确认时间：</strong>{formatDate(modalProject.stages[stage]?.confirmedAt) || "-"}</p>
                        {modalProject.stages[stage]?.files?.length > 0 ? (
                          <>
                            <p><strong>附件：</strong></p>
                            <ul className="list-disc pl-4">
                              {modalProject.stages[stage].files.map((f, i) => (
                                <li key={i}>
                                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600 text-xs">
                                    {getFileIcon(f.name)} {f.name}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p><strong>附件：</strong>无</p>
                        )}
                        {!modalProject.isAbnormal && (!modalProject.stages[stage] || modalProject.stages[stage]?.status === "待确认") && (
                          <div className="mt-2 space-y-2">
                            <div>
                              <label className="block text-[11px] font-medium mb-1">
                                上传附件（最多5个）
                              </label>
                              <input
                                type="file"
                                multiple
                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                                onChange={(e) => handleFileChange(e, stage)}
                                className="w-full file:rounded-full file:bg-blue-50 file:text-blue-700 file:text-xs file:py-1"
                              />
                              <div className="mt-1 space-y-1 max-h-20 overflow-y-auto">
                                {(form.files[stage] || []).map((f, i) => (
                                  <div key={i} className="flex items-center bg-gray-100 px-2 py-1 rounded text-[11px]">
                                    <span className="truncate mr-2" title={f.name}>
                                      {getFileIcon(f.name)} {f.name}
                                    </span>
                                    <button onClick={() => removeFile(stage, i)} className="text-red-500">×</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={() => handleConfirm(stage)}
                              disabled={modalLoading}
                              className={`w-full bg-blue-600 text-white py-1 rounded text-xs ${
                                modalLoading ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"
                              }`}
                            >
                              {modalLoading ? "确认中..." : `确认${stage}`}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {index < arr.length - 1 && (
                      <span className="text-gray-500 mx-2 text-lg">→</span>
                    )}
                  </div>
                ))}
              </div>
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>
          </div>
        </div>
      )}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg w-[400px] p-6 relative">
            <button onClick={closeCreateModal} className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-xl">×</button>
            <h3 className="text-xl font-semibold mb-4">新建项目</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  产品名称 <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className="w-full border rounded px-2 py-1.5 text-sm focus:ring-blue-500"
                  placeholder="请输入产品名称"
                />
              </div>
              <button
                onClick={handleInitiate}
                disabled={loading}
                className={`w-full bg-blue-600 text-white py-1.5 rounded text-sm ${
                  loading ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"
                }`}
              >
                {loading ? "创建中..." : "创建项目"}
              </button>
              {error && <p className="text-red-600 text-sm">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}