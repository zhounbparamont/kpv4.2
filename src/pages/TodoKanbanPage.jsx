import React, { useEffect, useState } from "react";
import AV from "../leancloud";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

const PriorityBadge = ({ priority }) => {
  const map = {
    紧急: "bg-red-100 text-red-800",
    高: "bg-orange-100 text-orange-800",
    中: "bg-yellow-100 text-yellow-800",
    低: "bg-green-100 text-green-800",
  };
  return (
    <span
      className={`px-2 py-0.5 text-xs rounded-full font-medium ${
        map[priority] || "bg-gray-100 text-gray-700"
      }`}
    >
      {priority}
    </span>
  );
};

const SortableItem = ({ todo, openModal }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: todo.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white border rounded p-3 mb-2 shadow-sm hover:shadow cursor-pointer"
      onClick={() => openModal(todo)}
    >
      <p className="font-medium text-sm">{todo.title}</p>
      <div className="flex justify-between items-center mt-2">
        <PriorityBadge priority={todo.priority} />
        <p className="text-xs text-gray-500">{todo.assignee}</p>
      </div>
      <p className="text-xs text-gray-400 mt-1">{formatDate(todo.createdAt)}</p>
    </div>
  );
};

export default function TodoKanbanPage() {
  const [todos, setTodos] = useState([]);
  const [filteredTodos, setFilteredTodos] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterSite, setFilterSite] = useState("全部");
  const [filterPriority, setFilterPriority] = useState("全部");
  const [filterAssignee, setFilterAssignee] = useState("全部");
  const [newTodo, setNewTodo] = useState({
    title: "",
    description: "",
    site: "",
    priority: "中",
    assignee: "",
    status: "待处理",
    files: [],
  });

  const statuses = ["待处理", "进行中", "已完成"];
  const priorities = ["紧急", "高", "中", "低"];
  const siteOptions = ["全部", "知客仓", ...new Set(todos.map((t) => t.site).filter(Boolean))];
  const assigneeOptions = ["全部", ...new Set(todos.map((t) => t.assignee).filter(Boolean))];

  useEffect(() => {
    document.title = "鲲鹏内部系统v1 - 待办事项";
    fetchTodos();
    return () => {
      document.title = "ERP System";
    };
  }, []);

  const fetchTodos = async () => {
    setLoading(true);
    try {
      const q = new AV.Query("TodoItem");
      q.descending("createdAt");
      const res = await q.find();
      const data = res.map((r) => ({ id: r.id, ...r.toJSON() }));
      setTodos(data);
      setFilteredTodos(data);
    } catch (err) {
      console.error("加载失败", err);
      alert("加载待办事项失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let result = [...todos];
    if (filterSite !== "全部") {
      result = result.filter((t) => t.site === filterSite);
    }
    if (filterPriority !== "全部") {
      result = result.filter((t) => t.priority === filterPriority);
    }
    if (filterAssignee !== "全部") {
      result = result.filter((t) => t.assignee === filterAssignee);
    }
    setFilteredTodos(result);
  }, [todos, filterSite, filterPriority, filterAssignee]);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeTodo = filteredTodos.find((t) => t.id === active.id);
    const overTodo = filteredTodos.find((t) => t.id === over.id);
    const activeStatus = activeTodo.status;
    const overStatus = overTodo.status;

    if (activeStatus !== overStatus) {
      try {
        const obj = AV.Object.createWithoutData("TodoItem", active.id);
        obj.set("status", overStatus);
        await obj.save();
        setTodos((prev) =>
          prev.map((t) => (t.id === active.id ? { ...t, status: overStatus } : t))
        );
      } catch (err) {
        console.error("更新状态失败", err);
        alert("更新任务状态失败，请稍后重试");
      }
    }
  };

  const openModal = (todo = null) => {
    if (todo) {
      setModal({ ...todo });
      setNewTodo({
        title: todo.title,
        description: todo.description || "",
        site: todo.site || "",
        priority: todo.priority || "中",
        assignee: todo.assignee || "",
        status: todo.status || "待处理",
        files: [],
      });
    } else {
      setModal(null);
      setNewTodo({
        title: "",
        description: "",
        site: "",
        priority: "中",
        assignee: "",
        status: "待处理",
        files: [],
      });
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setNewTodo((prev) => ({ ...prev, files }));
  };

  const saveTodo = async () => {
    if (!newTodo.title.trim()) return alert("请输入任务标题");
    if (!newTodo.site.trim()) return alert("请输入站点");
    if (!newTodo.assignee.trim()) return alert("请输入负责人");

    try {
      let fileList = [];
      if (newTodo.files.length > 0) {
        for (const file of newTodo.files) {
          const avFile = new AV.File(file.name, file);
          await avFile.save();
          fileList.push({ name: file.name, url: avFile.url() });
        }
      }

      let obj;
      if (modal) {
        obj = AV.Object.createWithoutData("TodoItem", modal.id);
      } else {
        obj = new AV.Object("TodoItem");
        obj.set("createdBy", AV.User.current()?.get("username") || "未知用户");
      }

      obj.set("title", newTodo.title);
      obj.set("description", newTodo.description);
      obj.set("site", newTodo.site);
      obj.set("priority", newTodo.priority);
      obj.set("assignee", newTodo.assignee);
      obj.set("status", newTodo.status);
      if (fileList.length > 0 || modal?.fileList) {
        obj.set("fileList", [...(modal?.fileList || []), ...fileList]);
      }

      await obj.save();
      setModal(null);
      fetchTodos();
      alert(modal ? "✅ 任务已更新" : "✅ 任务已创建");
    } catch (err) {
      console.error("保存失败", err);
      alert("保存任务失败，请稍后重试");
    }
  };

  const deleteTodo = async (id) => {
    if (!window.confirm("确认删除此任务吗？")) return;
    try {
      const obj = AV.Object.createWithoutData("TodoItem", id);
      await obj.destroy();
      fetchTodos();
      alert("✅ 任务已删除");
    } catch (err) {
      console.error("删除失败", err);
      alert("删除任务失败，请稍后重试");
    }
  };

  const handlePrint = (url, fileName) => {
    const pdfWindow = window.open(url, "_blank");
    if (!pdfWindow) {
      alert("无法打开 PDF，请检查浏览器是否阻止了弹出窗口");
    } else {
      pdfWindow.document.title = `查看 PDF: ${fileName}`;
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-blue-700 mb-6">📋 待办事项看板</h1>
      <div className="flex flex-wrap gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">按站点筛选</label>
          <select
            value={filterSite}
            onChange={(e) => setFilterSite(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {siteOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">按优先级筛选</label>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {["全部", ...priorities].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">按负责人筛选</label>
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {assigneeOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => openModal()}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 mt-6"
        >
          + 新建任务
        </button>
      </div>
      {loading && <p className="text-gray-500 mb-4">加载中...</p>}
      {!loading && filteredTodos.length === 0 && <p className="text-gray-500 mb-4">暂无任务</p>}
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-3 gap-4">
          {statuses.map((status) => (
            <div key={status} className="bg-gray-100 p-4 rounded-lg">
              <h2 className="text-lg font-semibold mb-4">{status}</h2>
              <SortableContext
                items={filteredTodos.filter((t) => t.status === status).map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {filteredTodos
                  .filter((t) => t.status === status)
                  .map((todo) => (
                    <SortableItem key={todo.id} todo={todo} openModal={openModal} />
                  ))}
              </SortableContext>
            </div>
          ))}
        </div>
      </DndContext>
      {modal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg w-[600px] max-h-[80vh] overflow-y-auto p-6 relative">
            <button
              onClick={() => setModal(null)}
              className="absolute top-3 right-3 text-gray-600 hover:text-black"
            >
              ×
            </button>
            <h2 className="text-lg font-bold mb-4">{modal ? "编辑任务" : "新建任务"}</h2>
            <div className="text-sm space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">标题 *</label>
                <input
                  type="text"
                  value={newTodo.title}
                  onChange={(e) => setNewTodo({ ...newTodo, title: e.target.value })}
                  placeholder="请输入任务标题"
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">描述</label>
                <textarea
                  value={newTodo.description}
                  onChange={(e) => setNewTodo({ ...newTodo, description: e.target.value })}
                  placeholder="请输入任务描述"
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows="4"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">站点 *</label>
                <input
                  type="text"
                  value={newTodo.site}
                  onChange={(e) => setNewTodo({ ...newTodo, site: e.target.value })}
                  placeholder="例如：知客仓"
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">优先级 *</label>
                <select
                  value={newTodo.priority}
                  onChange={(e) => setNewTodo({ ...newTodo, priority: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {priorities.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">负责人 *</label>
                <input
                  type="text"
                  value={newTodo.assignee}
                  onChange={(e) => setNewTodo({ ...newTodo, assignee: e.target.value })}
                  placeholder="请输入负责人姓名或ID"
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">状态</label>
                <select
                  value={newTodo.status}
                  onChange={(e) => setNewTodo({ ...newTodo, status: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">附件</label>
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="w-full text-sm text-gray-500"
                />
                {modal?.fileList?.length > 0 && (
                  <div className="mt-2">
                    <p><strong>已有附件:</strong></p>
                    <ul className="list-disc ml-6 text-xs space-y-1">
                      {modal.fileList.map((f, index) => (
                        <li key={index} className="flex items-center gap-2">
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
                              className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs hover:bg-blue-700"
                            >
                              打开
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={saveTodo}
                  className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700"
                >
                  保存
                </button>
                {modal && (
                  <button
                    onClick={() => deleteTodo(modal.id)}
                    className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700"
                  >
                    删除
                  </button>
                )}
                <button
                  onClick={() => setModal(null)}
                  className="bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700"
                >
                  取消
                </button>
              </div>
              {modal && (
                <p className="text-xs text-gray-500 mt-3">
                  创建者：{modal.createdBy || '--'}，创建时间：{formatDate(modal.createdAt)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}