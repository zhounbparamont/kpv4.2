import { useEffect, useState, useRef } from "react";
import AV from "../leancloud";
import { useNavigate } from "react-router-dom";
import * as XLSX from 'xlsx';

export default function InventoryPage() {
  const [stockList, setStockList] = useState([]);
  const [editingLocationId, setEditingLocationId] = useState(null);
  const [editedLocation, setEditedLocation] = useState("");
  const [editingCountryId, setEditingCountryId] = useState(null); // 新增：编辑国家ID
  const [editedCountry, setEditedCountry] = useState(""); // 新增：编辑国家值
  const [filteredList, setFilteredList] = useState([]);
  const [newItem, setNewItem] = useState({ sku: "", quantity: "", country: "" }); // 新增：country 字段
  const [editingItemId, setEditingItemId] = useState(null);
  const [editedQuantity, setEditedQuantity] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showZeroInventory, setShowZeroInventory] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [selectedSku, setSelectedSku] = useState("");
  const [targetSku, setTargetSku] = useState("");
  const [convertQuantity, setConvertQuantity] = useState(""); // 新增转换数量状态
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // 国家颜色映射
  const countryColors = {
    "澳洲": "bg-red-100 text-red-800 border border-red-300",
    "英国": "bg-blue-100 text-blue-800 border border-blue-300",
    "德国": "bg-green-100 text-green-800 border border-green-300",
    "加拿大": "bg-yellow-100 text-yellow-800 border border-yellow-300",
    "美国": "bg-purple-100 text-purple-800 border border-purple-300",
    "美国.TikTok": "bg-orange-100 text-orange-800 border border-orange-300"
  };

  // 获取当前用户并检查权限
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const isAuthorized = user.username === "cangku" || user.username === "alex";

  useEffect(() => {
    fetchStock();
  }, []);

  useEffect(() => {
    let filtered = stockList;

    console.log("🔍 当前 searchQuery:", searchQuery);
    if (searchQuery) {
      filtered = filtered.filter(item =>
        item.sku.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (!showZeroInventory) {
      filtered = filtered.filter(item => item.quantity > 0);
    }

    console.log("📊 最终展示项数量:", filtered.length);
    setFilteredList(filtered);
  }, [stockList, searchQuery, showZeroInventory]);

  const fetchStock = async () => {
    try {
      const stockQuery = new AV.Query("StockItem");
      stockQuery.ascending("sku");
      stockQuery.limit(1000);
      const stockResults = await stockQuery.find();

      const stockData = stockResults.map((item) => ({
        id: item.id,
        sku: item.get("sku"),
        quantity: item.get("quantity"),
        lastInboundAt: item.get("lastInboundAt"),
        location: item.get("location") || "",
        country: item.get("country") || "" // 新增：获取国家字段
      }));

      console.log("✅ 当前库存总数：", stockData.length);
      console.log("✅ SKU 列表：", stockData.map(i => i.sku));
      setStockList(stockData);
    } catch (error) {
      console.error("❌ 获取库存失败：", error.message || error);
    }
  };

  const handleEdit = (id, quantity) => {
    setEditingItemId(id);
    setEditedQuantity(quantity ? quantity.toString() : "");
  };

  const handleModifyClick = (id, quantity) => {
    if (!isAuthorized) {
      alert("无权限操作");
      return;
    }
    handleEdit(id, quantity);
  };

  // 手动+库存按钮点击处理：检查权限
  const handleAddStockClick = () => {
    if (!isAuthorized) {
      alert("无权限操作");
      return;
    }
    setShowAddModal(true);
  };

  const handleQuantityChange = (e) => {
    setEditedQuantity(e.target.value);
  };

  const saveQuantity = async (id) => {
    try {
      const itemToUpdate = AV.Object.createWithoutData("StockItem", id);
      itemToUpdate.set("quantity", parseInt(editedQuantity));
      await itemToUpdate.save();
      setEditingItemId(null);
      setEditedQuantity("");
      fetchStock();
    } catch (error) {
      console.error("❌ 更新库存数量失败：", error.message || error);
    }
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditedQuantity("");
  };

  // 新增：处理国家编辑点击
  const handleEditCountry = (id, country) => {
    setEditingCountryId(id);
    setEditedCountry(country || "");
  };

  // 新增：保存国家
  const saveCountry = async (id) => {
    try {
      const obj = AV.Object.createWithoutData("StockItem", id);
      obj.set("country", editedCountry);
      await obj.save();
      setEditingCountryId(null);
      setEditedCountry("");
      fetchStock();
    } catch (err) {
      console.error("更新备货国家失败", err);
      alert("更新备货国家失败：" + err.message);
    }
  };

  // 新增：取消国家编辑
  const cancelEditCountry = () => {
    setEditingCountryId(null);
    setEditedCountry("");
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "searchQuery") {
      setSearchQuery(value.toUpperCase());
    } else {
      const formattedValue =
        name === "sku" ? value.toUpperCase() : value;
      setNewItem({ ...newItem, [name]: formattedValue });
    }
  };

  const addStockItem = async () => {
    if (!newItem.sku || !newItem.quantity) {
      alert("SKU 和数量不能为空");
      return;
    }

    try {
      const normalizedSku = newItem.sku.trim().toUpperCase(); // 改为大写
      const quantityToAdd = parseInt(newItem.quantity);
      if (isNaN(quantityToAdd)) {
        alert("请输入有效的数量");
        return;
      }

      const query = new AV.Query("StockItem");
      query.equalTo("sku", normalizedSku);
      const existing = await query.find();

      if (existing.length > 0) {
        const item = existing[0];
        const currentQty = item.get("quantity") || 0;
        item.set("quantity", currentQty + quantityToAdd);
        // 新增：设置备货国家（如果提供）
        if (newItem.country) {
          item.set("country", newItem.country);
        }
        await item.save();
      } else {
        const StockItem = AV.Object.extend("StockItem");
        const newStock = new StockItem();
        newStock.set("sku", normalizedSku);
        newStock.set("quantity", quantityToAdd);
        // 新增：设置备货国家
        newStock.set("country", newItem.country || "");

        const acl = new AV.ACL();
        acl.setPublicReadAccess(true);
        acl.setPublicWriteAccess(true);
        newStock.setACL(acl);

        await newStock.save();
      }

      setNewItem({ sku: "", quantity: "", country: "" }); // 新增：重置country
      setShowAddModal(false);
      fetchStock();
    } catch (error) {
      console.error("❌ 新增库存失败：", error.message || error);
      alert("新增库存失败：" + error.message);
    }
  };

  const deleteItem = async (id) => {
    try {
      const item = AV.Object.createWithoutData("StockItem", id);
      await item.destroy();
      fetchStock();
    } catch (error) {
      console.error("❌ 删除失败：", error.message || error);
    }
  };

  const handleOutbound = (sku) => {
    navigate("/outbound", { state: { sku } });
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const binaryString = event.target.result;
      const workbook = XLSX.read(binaryString, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData && jsonData.length > 0) {
        const updates = [];
        const skusInFile = new Set();

        jsonData.forEach((row) => {
          if (row.SKU && row['库存数量']) {
            const sku = row.SKU.toString().trim().toUpperCase(); // 改为大写
            const quantity = parseInt(row['库存数量']);

            if (sku && !isNaN(quantity) && !skusInFile.has(sku)) {
              skusInFile.add(sku);
              updates.push({ sku, quantity });
            }
          }
        });

        try {
          const query = new AV.Query("StockItem");
          query.containedIn("sku", Array.from(skusInFile));
          const existingStockItems = await query.find();

          const existingSkuMap = new Map(existingStockItems.map(item => [item.get("sku"), item]));

          for (const { sku, quantity } of updates) {
            const existingItem = existingSkuMap.get(sku);
            if (existingItem) {
              const currentQty = existingItem.get("quantity") || 0;
              existingItem.set("quantity", currentQty + quantity);
              await existingItem.save();
            } else {
              const StockItem = AV.Object.extend("StockItem");
              const newStock = new StockItem();
              newStock.set("sku", sku);
              newStock.set("quantity", quantity);
              const acl = new AV.ACL();
              acl.setPublicReadAccess(true);
              acl.setPublicWriteAccess(true);
              newStock.setACL(acl);
              await newStock.save();
            }
          }

          alert("导入成功！");
          fetchStock();
        } catch (error) {
          console.error("导入失败：", error);
          alert("导入失败：" + error.message);
        }
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExport = () => {
    const data = filteredList.map(item => ({
      SKU: item.sku.toUpperCase(),
      '库存数量': item.quantity,
      库位: item.location || '',
      '备货国家': item.country || '', // 新增：导出国家
      '最近入库时间': item.lastInboundAt ? new Date(item.lastInboundAt).toLocaleString() : ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "库存数据");
    XLSX.writeFile(wb, `库存_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // 库存转换逻辑
  const handleConvertStock = async () => {
    if (!selectedSku || !targetSku || !convertQuantity) {
      alert("请选择源 SKU、输入目标 SKU 并输入转换数量");
      return;
    }

    const normalizedTargetSku = targetSku.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!normalizedTargetSku) {
      alert("目标 SKU 格式无效，仅允许字母、数字和 -");
      return;
    }

    const convQty = parseInt(convertQuantity);
    if (isNaN(convQty) || convQty <= 0) {
      alert("请输入有效的转换数量");
      return;
    }

    try {
      const query = new AV.Query("StockItem");
      query.equalTo("sku", selectedSku.toUpperCase()); // 假设源SKU已大写
      const sourceItem = await query.first();

      if (!sourceItem) {
        alert("源 SKU 不存在");
        return;
      }

      const sourceQty = sourceItem.get("quantity") || 0;
      if (convQty > sourceQty) {
        alert(`转换数量 (${convQty}) 不能超过源 SKU 库存 (${sourceQty})`);
        return;
      }

      const queryTarget = new AV.Query("StockItem");
      queryTarget.equalTo("sku", normalizedTargetSku);
      const targetItem = await queryTarget.first();

      if (targetItem) {
        // 如果目标 SKU 已存在，累加数量
        const currentQty = targetItem.get("quantity") || 0;
        targetItem.set("quantity", currentQty + convQty);
        await targetItem.save();
      } else {
        // 如果目标 SKU 不存在，创建新项
        const StockItem = AV.Object.extend("StockItem");
        const newTarget = new StockItem();
        newTarget.set("sku", normalizedTargetSku);
        newTarget.set("quantity", convQty);
        const acl = new AV.ACL();
        acl.setPublicReadAccess(true);
        acl.setPublicWriteAccess(true);
        newTarget.setACL(acl);
        await newTarget.save();
      }

      // 更新源 SKU 数量
      sourceItem.set("quantity", sourceQty - convQty);
      await sourceItem.save();

      // 如果源 SKU 数量为 0，删除源项
      if (sourceQty - convQty === 0) {
        await sourceItem.destroy();
      }

      setSelectedSku("");
      setTargetSku("");
      setConvertQuantity("");
      setShowConvertModal(false);
      fetchStock();
    } catch (error) {
      console.error("❌ 库存转换失败：", error.message || error);
      alert("库存转换失败：" + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* 顶部搜索和操作栏 */}
      <div className="bg-white p-6 flex flex-col">
        <div className="flex flex-wrap gap-4 mb-6 border-b pb-4 items-center">
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 shadow-sm text-sm"
          >
            导入 Excel
          </button>
          <button 
            onClick={handleExport} 
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 shadow-sm text-sm"
          >
            导出 Excel
          </button>
          <button 
            onClick={() => setShowZeroInventory(!showZeroInventory)}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 shadow-sm text-sm"
          >
            {showZeroInventory ? "隐藏0库存SKU" : "展开0库存SKU"}
          </button>
          <button 
            onClick={handleAddStockClick}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 shadow-sm text-sm"
          >
            手动+库存 🔒
          </button>
          <button 
            onClick={() => setShowConvertModal(true)}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 shadow-sm text-sm"
          >
            库存转换
          </button>
          <input
            type="text"
            name="searchQuery"
            value={searchQuery}
            onChange={handleChange}
            className="border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            placeholder="输入 SKU 进行模糊搜索"
          />
          <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".xlsx,.xls" />
        </div>

        {/* 库存表格 */}
        <table className="w-full border border-gray-200 rounded shadow-sm text-sm text-left">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-4 py-2 border-b">SKU</th>
              <th className="px-4 py-2 border-b">库存数量</th>
              <th className="px-4 py-2 border-b">库位</th>
              <th className="px-4 py-2 border-b">备货国家</th> {/* 新增：表头 */}
              <th className="px-4 py-2 border-b">操作</th>
              <th className="px-4 py-2 border-b">最近入库时间</th>
            </tr>
          </thead>
          <tbody>
            {filteredList.map((item) => (
              <tr key={item.id} className="hover:bg-blue-50">
                <td className="px-4 py-2 border-b font-mono">{item.sku.toUpperCase()}</td>
                <td className="px-4 py-2 border-b">
                  {editingItemId === item.id ? (
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        className="border rounded px-2 py-1 w-24 focus:ring"
                        value={editedQuantity}
                        onChange={handleQuantityChange}
                      />
                      <button
                        onClick={() => saveQuantity(item.id)}
                        className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 text-xs"
                      >保存</button>
                      <button onClick={cancelEdit} className="text-gray-500 hover:underline text-xs">取消</button>
                    </div>
                  ) : item.quantity}
                </td>
                {editingLocationId === item.id ? (
                  <td className="px-4 py-2 border-b">
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        className="border rounded px-2 py-1 w-24 focus:ring"
                        value={editedLocation}
                        onChange={(e) => setEditedLocation(e.target.value)}
                      />
                      <button
                        onClick={async () => {
                          try {
                            const obj = AV.Object.createWithoutData("StockItem", item.id);
                            obj.set("location", editedLocation);
                            await obj.save();
                            setEditingLocationId(null);
                            setEditedLocation("");
                            fetchStock();
                          } catch (err) {
                            console.error("更新库位失败", err);
                          }
                        }}
                        className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 text-xs"
                      >保存</button>
                      <button
                        onClick={() => {
                          setEditingLocationId(null);
                          setEditedLocation("");
                        }}
                        className="text-gray-500 hover:underline text-xs"
                      >取消</button>
                    </div>
                  </td>
                ) : (
                  <td
                    className="px-4 py-2 border-b text-gray-400 hover:text-gray-600 cursor-pointer"
                    onClick={() => {
                      setEditingLocationId(item.id);
                      setEditedLocation(item.location || "");
                    }}
                  >
                    {item.location ? item.location : `知客仓. ${item.country || ""}`}
                  </td>
                )}
                {/* 新增：备货国家列 */}
                <td className="px-4 py-2 border-b">
                  {editingCountryId === item.id ? (
                    <div className="flex items-center space-x-2">
                      <select
                        value={editedCountry}
                        onChange={(e) => setEditedCountry(e.target.value)}
                        className="border rounded px-2 py-1 w-32 focus:ring"
                      >
                        <option value="">请选择国家</option>
                        <option value="澳洲">澳洲</option>
                        <option value="英国">英国</option>
                        <option value="德国">德国</option>
                        <option value="加拿大">加拿大</option>
                        <option value="美国">美国</option>
                        <option value="美国.TikTok">美国.TikTok</option>
                      </select>
                      <button
                        onClick={() => saveCountry(item.id)}
                        className="bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 text-xs"
                      >保存</button>
                      <button
                        onClick={cancelEditCountry}
                        className="text-gray-500 hover:underline text-xs"
                      >取消</button>
                    </div>
                  ) : (
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 ${
                        item.country && countryColors[item.country] ? countryColors[item.country] : "text-gray-400"
                      }`}
                      onClick={() => handleEditCountry(item.id, item.country)}
                    >
                      {item.country || "点击修改"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 border-b space-x-4">
                  {editingItemId !== item.id && (
                    <button 
                      onClick={() => handleModifyClick(item.id, item.quantity)} 
                      className="text-blue-600 hover:underline text-xs"
                    >
                      修改 🔒
                    </button>
                  )}
                  <button onClick={() => handleOutbound(item.sku)} className="text-blue-600 hover:underline text-xs">出库</button>
                  <button onClick={() => deleteItem(item.id)} className="text-red-600 hover:underline text-xs">删除</button>
                </td>
                <td className="px-4 py-2 border-b text-gray-500">{item.lastInboundAt ? new Date(item.lastInboundAt).toLocaleString() : "-"}</td>
              </tr>
            ))}
            {filteredList.length === 0 && (
              <tr>
                <td colSpan="6" className="text-center text-gray-500 py-4">暂无库存记录</td> {/* 更新colSpan为6 */}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 手动+库存模态框 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl"
            >
              ×
            </button>
            <h3 className="text-xl font-bold mb-6 text-blue-800">新增 SKU</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">SKU</label>
                <input
                  type="text"
                  name="sku"
                  value={newItem.sku}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="SKU"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">数量</label>
                <input
                  type="number"
                  name="quantity"
                  value={newItem.quantity}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="数量"
                />
              </div>
              {/* 新增：备货国家选项 */}
              <div>
                <label className="block text-sm font-medium mb-2">备货国家</label>
                <select
                  name="country"
                  value={newItem.country}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">请选择国家</option>
                  <option value="澳洲">澳洲</option>
                  <option value="英国">英国</option>
                  <option value="德国">德国</option>
                  <option value="加拿大">加拿大</option>
                  <option value="美国">美国</option>
                  <option value="美国.TikTok">美国.TikTok</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={addStockItem}
                  className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 transition-colors"
                >
                  添加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 库存转换模态框 */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <button
              onClick={() => setShowConvertModal(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl"
            >
              ×
            </button>
            <h3 className="text-xl font-bold mb-6 text-blue-800">库存转换</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">选择源 SKU</label>
                <select
                  value={selectedSku}
                  onChange={(e) => setSelectedSku(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">请选择 SKU</option>
                  {stockList
                    .filter(item => item.quantity > 0)
                    .map((item) => (
                      <option key={item.id} value={item.sku}>
                        {item.sku.toUpperCase()} (库存: {item.quantity})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">目标 SKU</label>
                <input
                  type="text"
                  value={targetSku}
                  onChange={(e) => setTargetSku(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="输入目标 SKU（字母、数字和 - ）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">转换数量</label>
                <input
                  type="number"
                  value={convertQuantity}
                  onChange={(e) => setConvertQuantity(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="输入转换数量"
                  min="1"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowConvertModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConvertStock}
                  className="px-4 py-2 bg-purple-500 text-white rounded-md text-sm hover:bg-purple-600 transition-colors"
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}