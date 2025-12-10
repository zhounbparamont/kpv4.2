import React, { useState } from "react";
import AV from "../leancloud";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setError("");
  };

  const handleLogin = async () => {
    const { username, password } = form;
    if (!username || !password) {
      setError("请输入用户名和密码");
      return;
    }
    try {
      const user = await AV.User.logIn(username, password);
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("user", JSON.stringify({ username: user.getUsername() }));
      navigate("/inventory"); // 登录成功后跳转
    } catch (err) {
      setError("登录失败：" + (err.message || "未知错误"));
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white shadow-md rounded p-6 w-full max-w-sm">
        <h2 className="text-xl font-bold mb-4 text-blue-700">🔐 登录系统</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">用户名</label>
          <input
            type="text"
            name="username"
            value={form.username}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
            placeholder="请输入用户名"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">密码</label>
          <input
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            className="w-full border px-3 py-2 rounded"
            placeholder="请输入密码"
          />
        </div>

        {error && <p className="text-red-500 text-sm mb-2">{error}</p>}

        <button
          onClick={handleLogin}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          登录
        </button>
      </div>
    </div>
  );
}
