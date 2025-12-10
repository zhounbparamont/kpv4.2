import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import InventoryPage from './pages/InventoryPage';
import TodoKanbanPage from './pages/TodoKanbanPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/todo" element={<TodoKanbanPage />} />
        {/* 你可以在这里添加其他页面的 Route，比如： */}
        {/* <Route path="/order" element={<OrderPage />} /> */}
      </Routes>
    </Router>
  );
}

export default App;