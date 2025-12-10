import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

import LoginPage from './pages/LoginPage';
import StockManagementPage from './pages/StockManagementPage';
import OperateDispatchPage from './pages/OperateDispatchPage';
import PurchaseManagePage from './pages/PurchaseManagePage';
import OutboundManagePage from './pages/OutboundManagePage';
import WarehouseActionPage from './pages/WarehouseActionPage';
import TestReportPage from './pages/TestReportPage';
import ReworkManagePage from './pages/ReworkManagePage';
import ProductDevelopmentPage from './pages/ProductDevelopmentPage';
import LogisticsDashboard from './pages/LogisticsDashboard';
import TodoKanbanPage from './pages/TodoKanbanPage';
import RequireAuth from './components/RequireAuth';

// ✅ 新增：产品档案页面
import ProductProfilePage from './pages/ProductProfilePage';

function App() {
  const [user, setUser] = useState(() => {
    try {
      const storedUser = localStorage.getItem("user");
      return storedUser ? JSON.parse(storedUser) : {};
    } catch (error) {
      console.error("解析 localStorage 中的 user 失败:", error);
      return {};
    }
  });

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const storedUser = localStorage.getItem("user");
        setUser(storedUser ? JSON.parse(storedUser) : {});
      } catch (error) {
        console.error("更新 user 状态失败:", error);
        setUser({});
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("user");
    setUser({});
    window.location.href = "/login";
  };

  return (
    <Router>
      <nav className="bg-white shadow px-6 py-4 mb-6 flex justify-between">
        <ul className="flex space-x-6 text-gray-700">
          <li><Link to="/inventory" className="hover:text-blue-600">库存管理</Link></li>
          <li><Link to="/product-profile" className="hover:text-blue-600">产品档案</Link></li>
          <li><Link to="/dispatch" className="hover:text-blue-600">运营派单</Link></li>
          <li><Link to="/purchase" className="hover:text-blue-600">采购管理</Link></li>
          <li><Link to="/outbound" className="hover:text-blue-600">出库管理</Link></li>
          <li><Link to="/warehouse" className="hover:text-blue-600">仓库操作</Link></li>
          <li><Link to="/logistics" className="hover:text-blue-600">物流总表</Link></li>

          {/* ✅ 新增导航菜单：产品档案 */}

        </ul>

        <div className="flex items-center gap-4 ml-auto text-sm text-gray-600">
          <span>当前用户：{user.username || "未登录"}</span>
          <button onClick={handleLogout} className="text-blue-600 hover:underline">退出登录</button>
        </div>
      </nav>

      <div className="bg-gray-100 min-h-screen">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/inventory" element={<RequireAuth><StockManagementPage /></RequireAuth>} />
          <Route path="/dispatch" element={<RequireAuth><OperateDispatchPage /></RequireAuth>} />
          <Route path="/purchase" element={<RequireAuth><PurchaseManagePage /></RequireAuth>} />
          <Route path="/outbound" element={<RequireAuth><OutboundManagePage /></RequireAuth>} />
          <Route path="/warehouse" element={<RequireAuth><WarehouseActionPage /></RequireAuth>} />
          <Route path="/rework" element={<RequireAuth><ReworkManagePage /></RequireAuth>} />
          <Route path="/logistics" element={<RequireAuth><LogisticsDashboard /></RequireAuth>} />

          {/* ✅ 新增 ProductProfile 受保护页面 */}
          <Route path="/product-profile" element={<RequireAuth><ProductProfilePage /></RequireAuth>} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
