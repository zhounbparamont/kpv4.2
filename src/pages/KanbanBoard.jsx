import { useEffect, useState } from "react";
import AV from "../leancloud";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

export default function KanbanBoard() {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState({ title: "", status: "todo", assignee: "", dueDate: "", label: "", priority: "中" });
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [userList, setUserList] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showSubtaskModal, setShowSubtaskModal] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState(null);
  const [subtaskInput, setSubtaskInput] = useState({ title: "", dueDate: "" });
  const [viewSubtaskDetail, setViewSubtaskDetail] = useState(null);
  const statuses = ["todo", "doing", "team", "done"];

  useEffect(() => {
    fetchTasks();
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const query = new AV.Query("_User");
    query.limit(1000);
    const users = await query.find();
    const parsed = users.map((u) => ({ id: u.id, username: u.get("username") }));
    setUserList(parsed);
  };

  const fetchTasks = async () => {
    const query = new AV.Query("Task");
    query.include("assignee");
    query.ascending("createdAt");
    const results = await query.find();
    const parsed = results.map((t) => ({
      id: t.id,
      title: t.get("title"),
      status: t.get("status"),
      assignee: t.get("assignee")?.get("username") || "",
      assigneeId: t.get("assignee")?.id || "",
      dueDate: t.get("dueDate") ? new Date(t.get("dueDate")) : null,
      label: t.get("label") || "",
      priority: t.get("priority") || "中",
      subtasks: t.get("subtasks") || []
    }));
    setTasks(parsed);
  };

  const addTask = async () => {
    if (!newTask.title) return;
    const Task = AV.Object.extend("Task");
    const task = new Task();
    task.set("title", newTask.title);
    task.set("status", newTask.status);
    task.set("label", newTask.label);
    task.set("priority", newTask.priority);
    task.set("subtasks", []);
    if (newTask.assignee) {
      const pointer = AV.Object.createWithoutData("_User", newTask.assignee);
      task.set("assignee", pointer);
    }
    if (newTask.dueDate) {
      task.set("dueDate", new Date(newTask.dueDate));
    }
    await task.save();
    setNewTask({ title: "", status: "todo", assignee: "", dueDate: "", label: "", priority: "中" });
    setShowModal(false);
    fetchTasks();
  };

  const addSubtask = async () => {
    const task = AV.Object.createWithoutData("Task", currentTaskId);
    const record = tasks.find(t => t.id === currentTaskId);
    const newSubtasks = [...record.subtasks, {
      title: subtaskInput.title,
      completed: false,
      dueDate: subtaskInput.dueDate || null,
      description: "",
      attachment: ""
    }];
    task.set("subtasks", newSubtasks);
    await task.save();
    setShowSubtaskModal(false);
    setSubtaskInput({ title: "", dueDate: "" });
    fetchTasks();
  };

  const updateSubtaskDetail = async (taskId, index, updatedFields) => {
    const task = AV.Object.createWithoutData("Task", taskId);
    const current = tasks.find(t => t.id === taskId);
    const subtasks = [...current.subtasks];
    subtasks[index] = { ...subtasks[index], ...updatedFields };
    task.set("subtasks", subtasks);
    await task.save();
    fetchTasks();
  };

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId) return;
    const task = AV.Object.createWithoutData("Task", draggableId);
    task.set("status", destination.droppableId);
    await task.save();
    fetchTasks();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">📋 我的任务看板</h1>
      <button onClick={() => setShowModal(true)} className="bg-blue-600 text-white px-4 py-1 rounded mb-4">添加任务</button>

      {/* 新建任务弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow w-full max-w-md space-y-3">
            <h2 className="text-lg font-semibold">新建任务</h2>
            <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="任务标题" className="border px-3 py-2 rounded w-full" />
            <select value={newTask.assignee} onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })} className="border px-3 py-2 rounded w-full">
              <option value="">指派给...</option>
              {userList.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
            <input type="date" value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} className="border px-3 py-2 rounded w-full" />
            <input value={newTask.label} onChange={(e) => setNewTask({ ...newTask, label: e.target.value })} placeholder="标签" className="border px-3 py-2 rounded w-full" />
            <select value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })} className="border px-3 py-2 rounded w-full">
              <option value="高">高</option>
              <option value="中">中</option>
              <option value="低">低</option>
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="text-gray-600">取消</button>
              <button onClick={addTask} className="bg-blue-600 text-white px-4 py-1 rounded">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 添加子任务弹窗 */}
      {showSubtaskModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded shadow w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-2">添加子任务</h2>
            <input value={subtaskInput.title} onChange={(e) => setSubtaskInput({ ...subtaskInput, title: e.target.value })} placeholder="子任务标题" className="border px-3 py-2 rounded w-full mb-2" />
            <input type="date" value={subtaskInput.dueDate} onChange={(e) => setSubtaskInput({ ...subtaskInput, dueDate: e.target.value })} className="border px-3 py-2 rounded w-full mb-2" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSubtaskModal(false)} className="text-gray-600">取消</button>
              <button onClick={addSubtask} className="bg-blue-600 text-white px-4 py-1 rounded">添加</button>
            </div>
          </div>
        </div>
      )}

      {/* 显示任务列表 */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-4 gap-4">
          {statuses.map((status) => (
            <Droppable droppableId={status} key={status}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="bg-gray-100 p-4 rounded shadow min-h-[100px]">
                  <h2 className="text-lg font-semibold capitalize mb-2">
                    {status === "todo" ? "待处理" : status === "doing" ? "进行中" : status === "team" ? "团队任务" : "已完成"}
                  </h2>
                  {tasks.filter((t) => t.status === status).map((task, index) => (
                    <Draggable draggableId={task.id} index={index} key={task.id}>
                      {(provided) => (
                        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="bg-white border p-2 mb-2 rounded shadow text-sm">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-medium">{task.title}</div>
                              <div className="text-xs text-gray-500">指派：{task.assignee || "未指定"}</div>
                              {task.dueDate && (<div className={`text-xs ${new Date(task.dueDate) < new Date() ? 'text-red-600' : 'text-gray-500'}`}>截止：{new Date(task.dueDate).toLocaleDateString()}</div>)}
                              {task.label && <div className="text-xs text-blue-600">标签：{task.label}</div>}
                              <div className="text-xs text-yellow-600">优先级：{task.priority}</div>
                              {task.subtasks?.length > 0 && <div className="mt-1 space-y-1">
                                {task.subtasks.map((st, i) => (
                                  <div key={i} onClick={() => setViewSubtaskDetail({ taskId: task.id, index: i })} className="flex justify-between items-center bg-gray-50 px-2 py-1 rounded cursor-pointer hover:bg-blue-50">
                                    <span className={`text-xs ${st.completed ? 'line-through text-gray-400' : ''}`}>{st.title}</span>
                                    {st.dueDate && <span className="text-xs text-gray-400">{new Date(st.dueDate).toLocaleDateString()}</span>}
                                  </div>
                                ))}
                              </div>}
                            </div>
                            <button onClick={() => { setCurrentTaskId(task.id); setShowSubtaskModal(true); }} className="text-lg text-blue-500 font-bold">＋</button>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      {/* 子任务详情编辑框 */}
      {viewSubtaskDetail && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded shadow w-full max-w-md">
            <h2 className="text-lg font-semibold mb-2">子任务详情</h2>
            <input
              type="date"
              value={tasks.find(t => t.id === viewSubtaskDetail.taskId)?.subtasks[viewSubtaskDetail.index].dueDate?.slice(0, 10) || ""}
              onChange={(e) => updateSubtaskDetail(viewSubtaskDetail.taskId, viewSubtaskDetail.index, { dueDate: e.target.value })}
              className="border px-3 py-2 rounded w-full mb-2"
            />
            <textarea
              placeholder="描述"
              className="border px-3 py-2 rounded w-full mb-2"
              value={tasks.find(t => t.id === viewSubtaskDetail.taskId)?.subtasks[viewSubtaskDetail.index].description || ""}
              onChange={(e) => updateSubtaskDetail(viewSubtaskDetail.taskId, viewSubtaskDetail.index, { description: e.target.value })}
            />
            <input
              placeholder="附件链接"
              className="border px-3 py-2 rounded w-full mb-2"
              value={tasks.find(t => t.id === viewSubtaskDetail.taskId)?.subtasks[viewSubtaskDetail.index].attachment || ""}
              onChange={(e) => updateSubtaskDetail(viewSubtaskDetail.taskId, viewSubtaskDetail.index, { attachment: e.target.value })}
            />
            <div className="flex justify-end">
              <button onClick={() => setViewSubtaskDetail(null)} className="bg-blue-600 text-white px-4 py-1 rounded">完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
