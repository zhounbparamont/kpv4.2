import { useEffect, useState, useRef, useMemo } from "react";
import AV from "../leancloud";

function SiteBadge({ site }) {
  const base = "px-2 py-0.5 text-xs rounded-full font-medium";
  switch (site) {
    case "美国":
      return <span className={`${base} bg-blue-100 text-blue-800`}>站点: {site}</span>;
    case "德国":
      return <span className={`${base} bg-gray-100 text-gray-800`}>站点: {site}</span>;
    case "加拿大":
      return <span className={`${base} bg-red-100 text-red-800`}>站点: {site}</span>;
    case "英国":
      return <span className={`${base} bg-purple-100 text-purple-800`}>站点: {site}</span>;
    case "澳洲":
      return <span className={`${base} bg-green-100 text-green-800`}>站点: {site}</span>;
    case "香港账号":
      return <span className={`${base} bg-orange-100 text-orange-800`}>站点: {site}</span>;
    case "QY 美国":
      return <span className={`${base} bg-yellow-100 text-yellow-800`}>站点: {site}</span>;
    default:
      return <span className={`${base} bg-gray-100 text-gray-800`}>站点: {site || '-'}</span>;
  }
}

function TransactionTypeBadge({ type }) {
  const base = "px-2 py-0.5 text-xs rounded-full font-medium";
  if (type === "回款") return <span className={`${base} bg-green-100 text-green-800`}>{type}</span>;
  return <span className={`${base} bg-red-100 text-red-800`}>{type || '-'}</span>;
}

export default function FundManagementPage() {
  const [sites, setSites] = useState(["美国", "德国", "加拿大", "英国", "澳洲", "香港账号", "QY 美国"]);
  const [siteFunds, setSiteFunds] = useState({}); // { site: { balance: 0, objectId: null } }
  const [transactions, setTransactions] = useState([]);
  const [selectedSite, setSelectedSite] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [modalForm, setModalForm] = useState({ site: "", type: "回款", amount: "", description: "", selectedPurchase: "" });
  const [paymentForm, setPaymentForm] = useState({ transactionId: "", actualAmount: "", paymentDate: "" });
  const [purchaseOrders, setPurchaseOrders] = useState([]); // 已采购订单列表
  const [deductedPOs, setDeductedPOs] = useState(new Set()); // 已扣除的PO:SKU组合集合
  const [error, setError] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const hasOperatedRef = useRef(false);
  const initializedRef = useRef(false); // 防止重复初始化

  useEffect(() => {
    document.title = "鲲鹏内部系统v1 - 资金管理";
    initializeClassesAndData();
    return () => {
      document.title = "Order System";
    };
  }, []);

  // 计算已扣除的PO:SKU组合
  useEffect(() => {
    const deducted = new Set();
    transactions.forEach(t => {
      if (t.type === "采购扣除" && t.description.startsWith("采购订单 ")) {
        const poMatch = t.description.match(/采购订单 (.*?) \(/);
        const skuMatch = t.description.match(/\((.*?)\)/);
        if (poMatch && skuMatch) {
          const key = `${poMatch[1]}:${skuMatch[1]}`;
          deducted.add(key);
        }
      }
    });
    setDeductedPOs(deducted);
  }, [transactions]);

  // 计算每个站点的合同金额（非回款交易绝对值总和）
  const siteContractAmounts = useMemo(() => {
    const amounts = {};
    sites.forEach(site => {
      const siteTransactions = transactions.filter(t => t.site === site && t.type !== "回款");
      amounts[site] = siteTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    });
    return amounts;
  }, [transactions, sites]);

  // 计算每个站点的回款金额
  const siteRepayments = useMemo(() => {
    const amounts = {};
    sites.forEach(site => {
      const siteTransactions = transactions.filter(t => t.site === site && t.type === "回款");
      amounts[site] = siteTransactions.reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0);
    });
    return amounts;
  }, [transactions, sites]);

  // 自动初始化类和站点数据（如果不存在）
  const initializeClassesAndData = async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    setIsInitializing(true);
    try {
      // 初始化 SiteFund 记录（类会自动创建）
      await initializeSites();
      // 初始化 FundTransaction 类（通过保存一个空对象自动创建类）
      try {
        const testTransaction = new AV.Object("FundTransaction");
        testTransaction.set("site", "测试"); // 临时数据
        testTransaction.set("type", "测试");
        testTransaction.set("amount", 0);
        testTransaction.set("description", "初始化测试");
        await testTransaction.save();
        await testTransaction.destroy(); // 删除测试记录
        console.log("FundTransaction 类已自动创建");
      } catch (testErr) {
        if (testErr.code !== 111) { // 忽略已存在错误
          console.error("FundTransaction 初始化失败:", testErr);
        }
      }
      // 加载数据
      await fetchFunds();
      await fetchTransactions();
      await fetchPurchaseOrders();
    } catch (err) {
      console.error("自动初始化失败:", err);
      setError("自动初始化失败，请手动检查 LeanCloud 配置：" + err.message);
    } finally {
      setIsInitializing(false);
    }
  };

  // 初始化每个站点的 SiteFund 记录
  const initializeSites = async () => {
    for (const site of sites) {
      try {
        const q = new AV.Query("SiteFund");
        q.equalTo("site", site);
        const existing = await q.first();
        if (!existing) {
          const record = new AV.Object("SiteFund");
          record.set("site", site);
          record.set("balance", 0);
          record.set("actualPaid", 0);
          await record.save();
          console.log(`已自动创建 ${site} 站点记录`);
        }
      } catch (err) {
        if (err.code !== 111) { // 忽略已存在错误
          console.error(`初始化 ${site} 失败:`, err);
        }
      }
    }
  };

  const fetchFunds = async () => {
    try {
      const q = new AV.Query("SiteFund");
      const res = await q.find();
      const funds = {};
      sites.forEach(site => {
        const record = res.find(r => r.attributes.site === site);
        const attrs = record ? record.attributes : { balance: 0, actualPaid: 0 };
        funds[site] = { ...attrs, site, objectId: record ? record.id : null };
      });
      setSiteFunds(funds);
    } catch (err) {
      console.error("获取资金数据失败:", err);
      setError("加载资金数据失败：" + err.message);
      // 默认初始化
      const defaultFunds = {};
      sites.forEach(site => {
        defaultFunds[site] = { site, balance: 0, actualPaid: 0, objectId: null };
      });
      setSiteFunds(defaultFunds);
    }
  };

  const fetchTransactions = async () => {
    try {
      const q = new AV.Query("FundTransaction");
      q.limit(1000);
      q.addDescending("createdAt");
      const res = await q.find();
      const list = res.map(item => ({
        id: item.id,
        ...item.attributes,
        amount: item.attributes.amount || 0,
        actualPaid: item.attributes.actualPaid || 0,
        paymentDate: item.attributes.paymentDate || null,
        createdAt: item.attributes.createdAt || new Date().toISOString(),
      }));
      setTransactions(list);
    } catch (err) {
      console.error("获取交易记录失败:", err);
      setError("加载交易记录失败：" + err.message);
    }
  };

  // 新增：加载已采购订单
  const fetchPurchaseOrders = async () => {
    try {
      const q = new AV.Query("PurchaseRequest");
      q.equalTo("status", "已采购");
      const res = await q.find();
      const list = res.map(item => ({
        id: item.id,
        ...item.attributes,
        country: item.attributes.country || "",
        poNumber: item.attributes.poNumber || "",
        orderAmount: item.attributes.orderAmount || 0,
        sku: item.attributes.sku || "",
      })).filter(order => order.orderAmount > 0 && !deductedPOs.has(`${order.poNumber}:${order.sku}`));
      setPurchaseOrders(list);
    } catch (err) {
      console.error("加载采购订单失败:", err);
    }
  };

  const computeSiteSummary = (fundsObj) => {
    const totalActualPaid = Object.values(fundsObj).reduce((sum, f) => sum + (f.actualPaid || 0), 0);
    const totalContractAmount = transactions
      .filter(t => t.type !== "回款")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalRepayment = transactions
      .filter(t => t.type === "回款")
      .reduce((sum, t) => sum + t.amount, 0);
    const totalFundPool = totalRepayment - totalActualPaid;
    return {
      totalActualPaid,
      totalContractAmount,
      totalRepayment,
      totalFundPool,
    };
  };

  const handleSiteFilter = (e) => {
    setSelectedSite(e.target.value);
    hasOperatedRef.current = true;
  };

  const handleResetFilters = () => {
    setSelectedSite("");
    setStartDate("");
    setEndDate("");
    hasOperatedRef.current = true;
  };

  const openModal = (action = "manualTransaction") => {
    setModalForm({ site: "", type: "回款", amount: "", description: "", selectedPurchase: "" });
    setError("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalForm({ site: "", type: "回款", amount: "", description: "", selectedPurchase: "" });
    setError("");
  };

  const openPaymentModal = (transactionId, currentActual = 0, currentDate = null) => {
    const dateStr = currentDate ? new Date(currentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    setPaymentForm({ transactionId, actualAmount: currentActual.toString(), paymentDate: dateStr });
    setIsEditMode(currentActual > 0);
    setShowPaymentModal(true);
  };

  const closePaymentModal = () => {
    setShowPaymentModal(false);
    setPaymentForm({ transactionId: "", actualAmount: "", paymentDate: "" });
    setIsEditMode(false);
  };

  // 新增：处理复制交易
  const handleCopy = (transaction) => {
    setModalForm({
      site: transaction.site,
      type: transaction.type,
      amount: Math.abs(transaction.amount).toString(), // 绝对值，便于编辑
      description: transaction.description,
      selectedPurchase: "",
    });
    setShowModal(true);
  };

  // 新增：处理删除交易
  const handleDelete = async (id, site, amount) => {
    if (!confirm("确认删除此交易记录？此操作将反向更新余额。")) return;
    try {
      const record = AV.Object.createWithoutData("FundTransaction", id);
      await record.destroy();

      // 反向更新余额
      const currentFund = siteFunds[site];
      const newBalance = (currentFund.balance || 0) - amount; // 反向：减去原金额（相当于加回）
      let fundRecord;
      if (currentFund.objectId) {
        fundRecord = AV.Object.createWithoutData("SiteFund", currentFund.objectId);
      } else {
        fundRecord = new AV.Object("SiteFund");
        fundRecord.set("site", site);
      }
      fundRecord.set("balance", newBalance);
      await fundRecord.save();

      setSiteFunds(prev => ({
        ...prev,
        [site]: { ...prev[site], balance: newBalance, objectId: fundRecord.id }
      }));

      fetchTransactions(); // 刷新列表
      alert("删除成功");
      hasOperatedRef.current = true;
    } catch (err) {
      console.error("删除失败:", err);
      alert("删除失败：" + err.message);
    }
  };

  const handleModalChange = (e) => {
    const { name, value } = e.target;
    setModalForm(prev => {
      const newForm = { ...prev, [name]: value };
      if (name === "type" && value !== "采购扣除" && prev.selectedPurchase) {
        newForm.selectedPurchase = "";
        newForm.site = "";
        newForm.amount = "";
        newForm.description = "";
      }
      return newForm;
    });
    setError("");
  };

  const handlePaymentChange = (e) => {
    const { name, value } = e.target;
    setPaymentForm(prev => ({ ...prev, [name]: value }));
  };

  // 新增：处理选择采购订单
  const handlePurchaseSelect = (e) => {
    const selectedId = e.target.value;
    const order = purchaseOrders.find(p => p.id === selectedId);
    if (order) {
      setModalForm(prev => ({
        ...prev,
        site: order.country,
        type: "采购扣除",
        amount: order.orderAmount.toString(),
        description: `采购订单 ${order.poNumber} (${order.sku})`,
        selectedPurchase: selectedId,
      }));
    }
  };

  const handleModalSave = async () => {
    const { site, type, amount, description, selectedPurchase } = modalForm;
    let amt = parseFloat(amount);
    if (!site) {
      setError("请选择站点");
      return;
    }
    if (isNaN(amt)) {
      setError("金额必须是数字");
      return;
    }
    if (type === "回款" && amt < 0) {
      amt = Math.abs(amt); // 确保回款为正
    } else if (type !== "回款" && amt > 0) {
      amt = -amt; // 确保其他为负
    }
    // 防止重复添加：如果选择了采购订单，检查是否已有扣除记录
    if (type === "采购扣除" && selectedPurchase) {
      try {
        const order = purchaseOrders.find(p => p.id === selectedPurchase);
        if (order) {
          const q = new AV.Query("FundTransaction");
          q.equalTo("type", "采购扣除");
          q.contains("description", `采购订单 ${order.poNumber} (${order.sku})`);
          const existing = await q.first();
          if (existing) {
            setError(`该订单（PO: ${order.poNumber}, SKU: ${order.sku}）已添加过扣除记录`);
            return;
          }
        }
      } catch (checkErr) {
        console.error("检查重复失败:", checkErr);
      }
    }
    // 移除余额检查，允许负数
    try {
      const transaction = new AV.Object("FundTransaction");
      transaction.set("site", site);
      transaction.set("type", type);
      transaction.set("amount", amt);
      transaction.set("description", description || `${type}记录`);
      await transaction.save();

      // 更新站点余额
      const currentFund = siteFunds[site];
      const newBalance = (currentFund.balance || 0) + amt;
      let fundRecord;
      if (currentFund.objectId) {
        fundRecord = AV.Object.createWithoutData("SiteFund", currentFund.objectId);
      } else {
        fundRecord = new AV.Object("SiteFund");
        fundRecord.set("site", site);
      }
      fundRecord.set("balance", newBalance);
      await fundRecord.save();

      setSiteFunds(prev => ({
        ...prev,
        [site]: { ...prev[site], balance: newBalance, objectId: fundRecord.id }
      }));

      alert(`${type}记录成功`);
      closeModal();
      fetchTransactions(); // 刷新交易列表
      hasOperatedRef.current = true;
    } catch (err) {
      console.error("保存交易失败:", err);
      setError("保存失败：" + err.message);
    }
  };

  const handlePaymentSave = async () => {
    const { transactionId, actualAmount, paymentDate } = paymentForm;
    const actualAmt = parseFloat(actualAmount);
    if (!transactionId || isNaN(actualAmt) || actualAmt < 0) {
      alert("请填写有效的实付金额（非负数）");
      return;
    }
    try {
      const oldActual = transactions.find(t => t.id === transactionId)?.actualPaid || 0;
      const delta = actualAmt - oldActual;

      const transaction = AV.Object.createWithoutData("FundTransaction", transactionId);
      transaction.set("actualPaid", actualAmt);
      if (paymentDate) {
        transaction.set("paymentDate", new Date(paymentDate));
      }
      await transaction.save();

      // 更新站点实付费用，如果有变化
      if (delta !== 0) {
        const transactionData = transactions.find(t => t.id === transactionId);
        if (transactionData) {
          const site = transactionData.site;
          const currentFund = siteFunds[site];
          const newActualPaid = (currentFund.actualPaid || 0) + delta;
          let fundRecord;
          if (currentFund.objectId) {
            fundRecord = AV.Object.createWithoutData("SiteFund", currentFund.objectId);
          } else {
            fundRecord = new AV.Object("SiteFund");
            fundRecord.set("site", site);
          }
          fundRecord.set("actualPaid", newActualPaid);
          await fundRecord.save();

          setSiteFunds(prev => ({
            ...prev,
            [site]: { ...prev[site], actualPaid: newActualPaid, objectId: fundRecord.id }
          }));
        }
      }

      alert("订单支付记录保存成功");
      closePaymentModal();
      fetchTransactions();
      hasOperatedRef.current = true;
    } catch (err) {
      console.error("保存支付记录失败:", err);
      alert("保存失败：" + err.message);
    }
  };

  // 模拟采购扣除：实际应在采购页面调用此逻辑，允许负数
  const handlePurchaseDeduct = async (purchaseId, site, deductAmount) => {
    if (deductAmount <= 0) return;
    // 移除余额检查
    try {
      const transaction = new AV.Object("FundTransaction");
      transaction.set("site", site);
      transaction.set("type", "采购扣除");
      transaction.set("amount", -deductAmount); // 负数表示扣除
      transaction.set("description", `采购订单 ${purchaseId}`);
      await transaction.save();

      const newBalance = (siteFunds[site]?.balance || 0) - deductAmount;
      let fundRecord;
      const currentFund = siteFunds[site];
      if (currentFund.objectId) {
        fundRecord = AV.Object.createWithoutData("SiteFund", currentFund.objectId);
      } else {
        fundRecord = new AV.Object("SiteFund");
        fundRecord.set("site", site);
        fundRecord.set("initial", currentFund.initial || 0);
      }
      fundRecord.set("balance", newBalance);
      await fundRecord.save();

      setSiteFunds(prev => ({
        ...prev,
        [site]: { ...prev[site], balance: newBalance, objectId: fundRecord.id }
      }));

      fetchTransactions();
      hasOperatedRef.current = true;
    } catch (err) {
      console.error("扣除失败:", err);
      alert("扣除失败：" + err.message);
    }
  };

  // 过滤交易记录
  const filteredTransactions = (() => {
    let filtered = transactions;
    if (selectedSite) {
      filtered = filtered.filter(item => item.site === selectedSite);
    }
    if (startDate) {
      filtered = filtered.filter(item => new Date(item.createdAt) >= new Date(startDate));
    }
    if (endDate) {
      filtered = filtered.filter(item => new Date(item.createdAt) <= new Date(endDate));
    }
    return filtered;
  })();

  if (isInitializing) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-blue-800 mb-6">资金管理</h1>
        <div className="text-center text-gray-500">正在自动初始化数据，请稍候...</div>
      </div>
    );
  }

  const siteSummary = computeSiteSummary(siteFunds);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold text-blue-800 mb-6">资金管理</h1>

      {/* 统计卡片：总余额 + 每个站点余额 */}
      <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        {/* 总可用资金卡片 */}
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-600 mb-2">总可用资金</h3>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-600">实付金额</span>
              <span className="text-lg font-bold text-blue-600">¥{siteSummary.totalActualPaid.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-600">合同金额</span>
              <span className="text-sm text-gray-700">¥{siteSummary.totalContractAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-600">回款金额</span>
              <span className="text-sm text-gray-700">¥{siteSummary.totalRepayment.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-600">资金池总额</span>
              <span className={`text-sm ${siteSummary.totalFundPool >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ¥{siteSummary.totalFundPool.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
        {/* 每个站点卡片 */}
        {sites.map(site => {
          const actualPaid = siteFunds[site]?.actualPaid || 0;
          const contractAmount = siteContractAmounts[site] || 0;
          const repayment = siteRepayments[site] || 0;
          const fundPool = repayment - actualPaid;
          return (
            <div key={site} className="bg-white p-4 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-600 mb-2">{site} 站点</h3>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-600">实付</span>
                  <span className="text-lg font-bold text-green-600">¥{actualPaid.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-600">合同金额</span>
                  <span className="text-sm text-gray-900">¥{contractAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-600">回款金额</span>
                  <span className="text-sm text-gray-700">¥{repayment.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-gray-600">资金池</span>
                  <span className={`text-sm ${fundPool >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ¥{fundPool.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 交易记录表格上方：筛选和手动输入按钮 */}
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-900 inline-block mr-6">交易记录</h2>
        <div className="inline-flex items-center space-x-4">
          {/* 站点筛选 */}
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">站点:</label>
            <select
              value={selectedSite}
              onChange={handleSiteFilter}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部站点</option>
              {sites.map(site => (
                <option key={site} value={site}>{site}</option>
              ))}
            </select>
          </div>
          {/* 时间筛选 */}
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">时间从:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">到:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {/* 复位按钮 */}
          <button
            onClick={handleResetFilters}
            className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
          >
            复位
          </button>
          {/* 手动输入按钮 */}
          <button
            onClick={() => openModal("manualTransaction")}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            手动输入交易
          </button>
        </div>
      </div>

      {/* 交易记录表格 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">站点</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">合同金额</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">实付金额</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">描述</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                    {selectedSite || startDate || endDate ? "没有匹配的记录" : "暂无交易记录"}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <SiteBadge site={t.site} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <TransactionTypeBadge type={t.type} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ¥{t.amount > 0 ? t.amount.toFixed(2) : `-${Math.abs(t.amount).toFixed(2)}`}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`text-sm cursor-pointer hover:underline ${
                          t.actualPaid ? 'text-gray-900 hover:text-blue-600' : 'text-gray-500 hover:text-blue-600'
                        }`}
                        onClick={() => openPaymentModal(t.id, t.actualPaid || 0, t.paymentDate)}
                      >
                        {t.actualPaid ? `¥${t.actualPaid.toFixed(2)}` : '未支付'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {t.description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleCopy(t)}
                        className="text-blue-600 hover:text-blue-900 text-xs"
                      >
                        复制
                      </button>
                      <button
                        onClick={() => handleDelete(t.id, t.site, t.amount)}
                        className="text-red-600 hover:text-red-900 text-xs"
                      >
                        删除
                      </button>
                      {(!t.actualPaid || t.actualPaid === 0) && (
                        <button
                          onClick={() => openPaymentModal(t.id)}
                          className="text-green-600 hover:text-green-900 text-xs"
                        >
                          订单支付
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <p className="text-red-600 text-sm mt-4">{error}</p>
      )}

      {/* 模态框：手动输入交易 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl"
            >
              ×
            </button>
            <h3 className="text-2xl font-semibold text-blue-800 mb-6">手动输入交易</h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block font-medium text-gray-700 mb-1">选择采购订单（可选，从已采购订单自动填充）</label>
                <select
                  name="selectedPurchase"
                  value={modalForm.selectedPurchase}
                  onChange={handlePurchaseSelect}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">手动输入或选择订单</option>
                  {purchaseOrders.map(order => (
                    <option key={order.id} value={order.id}>
                      {order.sku} - PO: {order.poNumber} - 站点: {order.country} - 金额: ¥{order.orderAmount.toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">站点（必填）</label>
                <select
                  name="site"
                  value={modalForm.site}
                  onChange={handleModalChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">请选择站点</option>
                  {sites.map(site => (
                    <option key={site} value={site}>{site}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">交易类型（必填）</label>
                <select
                  name="type"
                  value={modalForm.type}
                  onChange={handleModalChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="回款">回款（正金额）</option>
                  <option value="采购扣除">采购扣除（负金额）</option>
                  <option value="检测费用">检测费用（负金额）</option>
                  <option value="仓储费用">仓储费用（负金额）</option>
                  <option value="物流费用">物流费用（负金额）</option>
                  <option value="营销费用">营销费用（负金额）</option>
                  <option value="其他杂项">其他杂项（负金额）</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">合同金额(RMB)（必填）</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  value={modalForm.amount}
                  onChange={handleModalChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入金额（回款输入正数，其他输入正数自动转为负）"
                />
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">描述（可选）</label>
                <input
                  name="description"
                  type="text"
                  value={modalForm.description}
                  onChange={handleModalChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  placeholder="交易描述"
                />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleModalSave}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 模态框：订单支付 */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
            <button
              onClick={closePaymentModal}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-xl"
            >
              ×
            </button>
            <h3 className="text-2xl font-semibold text-blue-800 mb-6">
              {isEditMode ? "编辑订单支付" : "设置订单支付"}
            </h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block font-medium text-gray-700 mb-1">实付金额(RMB)（必填）</label>
                <input
                  name="actualAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentForm.actualAmount}
                  onChange={handlePaymentChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入实付金额"
                />
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">付款时间（必填）</label>
                <input
                  name="paymentDate"
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={handlePaymentChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={closePaymentModal}
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handlePaymentSave}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 注意：采购扣除逻辑应在采购页面集成，例如在handleModalSave中调用handlePurchaseDeduct(purchase.poNumber, purchase.country, purchase.orderAmount) */}
    </div>
  );
}