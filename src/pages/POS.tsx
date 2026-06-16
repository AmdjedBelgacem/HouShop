import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import type { Product, CartDisplayItem, CreateSale } from '../lib/types';
import { Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote, CheckCircle } from 'lucide-react';
export default function POS() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartDisplayItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saleComplete, setSaleComplete] = useState(false);
  const { data: products } = useQuery({
    queryKey: ['products', search],
    queryFn: () => search
      ? invoke<Product[]>('search_products', { query: search })
      : invoke<Product[]>('get_products'),
    enabled: search.length > 0 || true,
  });
  const createSaleMutation = useMutation({
    mutationFn: (data: CreateSale) => invoke('create_sale', { data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setCart([]);
      setSaleComplete(true);
      setTimeout(() => setSaleComplete(false), 3000);
    },
  });
  const addToCart = (product: Product) => {
    if (product.quantity <= 0) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.quantity) return prev;
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };
  const updateQuantity = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          if (newQty > item.product.quantity) return item;
          return { ...item, quantity: newQty };
        })
        .filter(Boolean) as CartDisplayItem[]
    );
  };
  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };
  const total = cart.reduce((sum, item) => sum + item.product.selling_price * item.quantity, 0);
  const totalCost = cart.reduce((sum, item) => sum + item.product.cost_price * item.quantity, 0);
  const profit = total - totalCost;
  const handleCheckout = () => {
    if (cart.length === 0) return;
    createSaleMutation.mutate({
      items: cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.product.selling_price,
        unit_cost: item.product.cost_price,
      })),
      customer_id: null,
      payment_method: paymentMethod,
    });
  };
  return (
    <div className="h-full flex">
      {}
      <div className="flex-1 p-6 flex flex-col overflow-hidden">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Point of Sale</h2>
        {}
        <div className="relative mb-4">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search or scan barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            autoFocus
          />
        </div>
        {}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {products?.filter((p) => p.quantity > 0).map((product) => (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-primary-300 hover:shadow-sm transition-all"
              >
                <p className="font-medium text-gray-900 text-sm truncate">{product.name}</p>
                <p className="text-xs text-gray-500 mt-1">{product.category_name ?? 'Uncategorized'}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-lg font-bold text-primary-600">${product.selling_price.toFixed(2)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    product.quantity <= product.low_stock_threshold ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {product.quantity} left
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      {}
      <div className="w-96 bg-white border-l border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ShoppingCart size={20} className="text-primary-600" />
            <h3 className="font-semibold text-gray-900">Cart</h3>
            <span className="ml-auto bg-primary-100 text-primary-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {cart.reduce((sum, i) => sum + i.quantity, 0)} items
            </span>
          </div>
        </div>
        {}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Cart is empty</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.product.id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <p className="font-medium text-gray-900 text-sm flex-1">{item.product.name}</p>
                  <button onClick={() => removeFromCart(item.product.id)} className="text-red-400 hover:text-red-600 ml-2">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQuantity(item.product.id, -1)}
                      className="w-7 h-7 rounded-lg bg-white border border-gray-300 flex items-center justify-center hover:bg-gray-100">
                      <Minus size={12} />
                    </button>
                    <span className="text-sm font-medium w-8 text-center">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.product.id, 1)}
                      className="w-7 h-7 rounded-lg bg-white border border-gray-300 flex items-center justify-center hover:bg-gray-100">
                      <Plus size={12} />
                    </button>
                  </div>
                  <span className="font-medium text-gray-900 text-sm">
                    ${(item.product.selling_price * item.quantity).toFixed(2)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
        {}
        <div className="p-4 border-t border-gray-200 space-y-4">
          {}
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border transition-colors ${
                paymentMethod === 'cash' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-600'
              }`}
            >
              <Banknote size={16} /> Cash
            </button>
            <button
              onClick={() => setPaymentMethod('card')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium border transition-colors ${
                paymentMethod === 'card' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-600'
              }`}
            >
              <CreditCard size={16} /> Card
            </button>
          </div>
          {}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span><span>${total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Profit</span><span className="text-green-600">${profit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200">
              <span>Total</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
          {saleComplete && (
            <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-lg p-3 text-sm">
              <CheckCircle size={18} /> Sale completed successfully!
            </div>
          )}
          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || createSaleMutation.isPending}
            className="w-full py-3 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createSaleMutation.isPending ? 'Processing...' : `Complete Sale — $${total.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
