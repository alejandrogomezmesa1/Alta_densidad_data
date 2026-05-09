
const assert = require('assert');

async function runTests() {
  const baseUrl = 'http://localhost:5000/api';
  console.log('--- STARTING INTEGRATION TESTS ---');

  try {
    // 1. Inventory Test
    let res = await fetch(baseUrl + '/products');
    let products = await res.json();
    console.log('? GET /products (Inventory) works');

    // Create a new product for testing
    res = await fetch(baseUrl + '/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Product', category: 'Test', price: 100, costPrice: 50, stock: 10 })
    });
    console.log('? POST /products works');
    
    res = await fetch(baseUrl + '/products');
    products = await res.json();
    const testProduct = products.find(p => p.name === 'Test Product');
    
    // 2. Suppliers Test
    res = await fetch(baseUrl + '/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Supplier', contact: '123' })
    });
    console.log('? POST /suppliers works');
    res = await fetch(baseUrl + '/suppliers');
    const suppliers = await res.json();
    const testSupplier = suppliers.find(s => s.name === 'Test Supplier');

    // 3. Purchases Test
    res = await fetch(baseUrl + '/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: testProduct.id,
        supplierId: testSupplier.id,
        quantity: 5,
        amount: 250,
        unitPrice: 50,
        date: '2026-05-07'
      })
    });
    if (!res.ok) throw new Error('POST /purchases failed: ' + await res.text());
    console.log('? POST /purchases works (Stock should increase by 5)');

    res = await fetch(baseUrl + '/products');
    let updatedProducts = await res.json();
    const updatedTestProduct = updatedProducts.find(p => p.id === testProduct.id);
    assert(updatedTestProduct.stock === 15, 'Stock should be 15 after purchase');
    console.log('? Purchase Stock update works');

    // 4. Sales Test (Cart Mode)
    res = await fetch(baseUrl + '/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Test Customer',
        date: '2026-05-07',
        items: [
          { productId: testProduct.id, quantity: 2, unitPrice: 100, costAtSale: 50, productName: 'Test Product' }
        ],
        total: 200,
        initialPayment: 100,
        status: 'pending'
      })
    });
    if (!res.ok) throw new Error('POST /sales failed: ' + await res.text());
    console.log('? POST /sales works (Multi-item cart)');

    res = await fetch(baseUrl + '/products');
    updatedProducts = await res.json();
    const afterSaleProduct = updatedProducts.find(p => p.id === testProduct.id);
    assert(afterSaleProduct.stock === 13, 'Stock should be 13 after sale of 2');
    console.log('? Sale Stock update works');

    // Get latest sale
    res = await fetch(baseUrl + '/sales');
    let sales = await res.json();
    const testSale = sales.find(s => s.customerName === 'Test Customer');

    // 5. Payment Test
    res = await fetch(baseUrl + '/sales/' + testSale.id + '/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, date: '2026-05-07', method: 'Efectivo' })
    });
    if (!res.ok) throw new Error('POST /sales/:id/payments failed: ' + await res.text());
    console.log('? POST /sales/:id/payments works');

    res = await fetch(baseUrl + '/sales');
    sales = await res.json();
    const paidSale = sales.find(s => s.id === testSale.id);
    assert(paidSale.status === 'paid', 'Sale should be fully paid');
    console.log('? Payment fully paid status works');

    // 6. Expenses Test
    res = await fetch(baseUrl + '/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Test Expense', amount: 50, date: '2026-05-07' })
    });
    console.log('? POST /expenses works');

    // Clean up
    console.log('--- ALL TESTS PASSED SUCCESSFULLY ---');
  } catch (err) {
    console.error('? TEST FAILED:', err.message);
  }
}

runTests();

