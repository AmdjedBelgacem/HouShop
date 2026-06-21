import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './theme';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import AddProduct from './pages/AddProduct';
import Checkout from './pages/Checkout';
import Sales from './pages/Sales';
import Customers from './pages/Customers';
import AddCustomer from './pages/AddCustomer';
import Profile from './pages/Profile';
import Reservations from './pages/Reservations';
import Logs from './pages/Logs';
import type { Product, CustomerWithStats } from './lib/types';
import { useState, useCallback } from 'react';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
type Page = 'dashboard' | 'products' | 'add-product' | 'edit-product' | 'history' | 'customers' | 'add-customer' | 'edit-customer' | 'reservations' | 'pos' | 'profile' | 'logs';
function AppContent() {
  const { isAuthenticated } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithStats | null>(null);
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);

  const handleScan = useCallback((product: Product) => {
    setScannedProduct(product);
    setCurrentPage('pos');
  }, []);

  useBarcodeScanner(handleScan);

  if (!isAuthenticated) {
    return <Login />;
  }
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard onNavigate={(p) => setCurrentPage(p as Page)} />;
      case 'products': return <Products onAddProduct={() => { setEditingProduct(null); setCurrentPage('add-product'); }} onEditProduct={(p) => { setEditingProduct(p); setCurrentPage('edit-product'); }} />;
      case 'add-product': return <AddProduct onBack={() => setCurrentPage('products')} />;
      case 'edit-product': return <AddProduct onBack={() => setCurrentPage('products')} editProduct={editingProduct} />;
      case 'history': return <Sales />;
      case 'customers': return <Customers onAddCustomer={() => { setEditingCustomer(null); setCurrentPage('add-customer'); }} onEditCustomer={(c) => { setEditingCustomer(c); setCurrentPage('edit-customer'); }} />;
      case 'add-customer': return <AddCustomer onBack={() => setCurrentPage('customers')} />;
      case 'edit-customer': return <AddCustomer onBack={() => setCurrentPage('customers')} editCustomer={editingCustomer} />;
      case 'reservations': return <Reservations />;
      case 'pos': return <Checkout scannedProduct={scannedProduct} onScanHandled={() => setScannedProduct(null)} />;
      case 'profile': return <Profile />;
      case 'logs': return <Logs onBack={() => setCurrentPage('dashboard')} />;
      default: return <Dashboard onNavigate={(p) => setCurrentPage(p as Page)} />;
    }
  };
  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      {renderPage()}
    </Layout>
  );
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
