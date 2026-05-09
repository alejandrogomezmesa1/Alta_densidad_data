
const assert = require('assert');

async function runTests() {
  const baseUrl = 'http://localhost:5000/api';
  console.log('--- STARTING COST TESTS ---');

  try {
    // 1. Create a product with stock 10, cost 50
    let res = await fetch(baseUrl + '/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cost Test Product', category: 'Test', price: 100, costPrice: 50, stock: 10 })
    });
    
    res = await fetch(baseUrl + '/products');
    let products = await res.json();
    let product = products.find(p => p.name === 'Cost Test Product');
    
    // 2. Buy 10 more at 100
    res = await fetch(baseUrl + '/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: product.id,
        supplierId: null,
        quantity: 10,
        amount: 1000,
        unitPrice: 100,
        date: '2026-05-07'
      })
    });
    let newPurchase = await res.json();
    
    // 3. Verify the new cost is 75. 
    // formula: ((10*50) + (10*100)) / 20 = (500 + 1000)/20 = 1500/20 = 75
    res = await fetch(baseUrl + '/products');
    products = await res.json();
    product = products.find(p => p.id === product.id);
    console.log('Current Cost after Purchase 1:', product.costPrice);
    assert(parseFloat(product.costPrice) === 75, 'Cost should be 75');

    // 4. Update the purchase to be 20 at 200
    res = await fetch(baseUrl + '/purchases/' + newPurchase.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          supplierId: null,
          quantity: 20,
          amount: 4000,
          unitPrice: 200,
          date: '2026-05-07'
        })
    });

    // formula reversion: subtract the original 10 at 100 -> back to 10 stock at 50
    // formula addition: add 20 at 200 -> ( (10*50) + (20*200) ) / 30 = (500 + 4000) / 30 = 4500 / 30 = 150
    res = await fetch(baseUrl + '/products');
    products = await res.json();
    product = products.find(p => p.id === product.id);
    console.log('Current Cost after Update:', product.costPrice);
    assert(parseFloat(product.costPrice) === 150, 'Cost should be 150');

    // 5. Delete the purchase -> back to 10 stock at 50
    res = await fetch(baseUrl + '/purchases/' + newPurchase.id, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    });

    res = await fetch(baseUrl + '/products');
    products = await res.json();
    product = products.find(p => p.id === product.id);
    console.log('Current Cost after Delete:', product.costPrice);
    assert(parseFloat(product.costPrice) === 50, 'Cost should be 50');

    console.log('? ALL COST TESTS PASSED');
  } catch (e) {
    console.error('?', e);
  }
}
runTests();

