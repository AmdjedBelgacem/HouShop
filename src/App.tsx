import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider, AUTH_EXPIRED_EVENT } from './hooks/useAuth';
import { useAuth } from './hooks/authContext';
import { BrandingProvider } from './hooks/useBranding';
import { I18nProvider, useI18n } from './i18n';
import { ThemeProvider } from './theme';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import ProductEvaluation from './pages/ProductEvaluation';
import AddProduct from './pages/AddProduct';
import Checkout from './pages/Checkout';
import Sales from './pages/Sales';
import Customers from './pages/Customers';
import AddCustomer from './pages/AddCustomer';
import Profile from './pages/Profile';
import Reservations from './pages/Reservations';
import Returns from './pages/Returns';
import Logs from './pages/Logs';
import DataTransfer from './pages/DataTransfer';
import Diagnostics from './pages/Diagnostics';
import PhoneWipe from './pages/PhoneWipe';
import type { Product, CustomerWithStats, ProductVariant, BarcodeLookup } from './lib/types';
import { useState, useCallback } from 'react';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
const queryClient = new QueryClient({
  // A "Not signed in" rejection means the backend session is gone: return to
  // the sign-in screen instead of showing every page as broken.
  queryCache: new QueryCache({
    onError: (error) => {
      const msg = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
      if (msg === 'Not signed in') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
type Page = 'dashboard' | 'products' | 'product-evaluation' | 'add-product' | 'edit-product' | 'history' | 'customers' | 'add-customer' | 'edit-customer' | 'reservations' | 'returns' | 'transfer' | 'diagnostics' | 'wipe' | 'pos' | 'profile' | 'logs';
function AppContent() {
  const { isAuthenticated, ready } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithStats | null>(null);
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [scannedVariant, setScannedVariant] = useState<ProductVariant | null>(null);

  const handleScan = useCallback((lookup: BarcodeLookup) => {
    setScannedProduct(lookup.product);
    setScannedVariant(lookup.variant);
    setCurrentPage('pos');
  }, []);

  useBarcodeScanner(handleScan);

  if (!ready) return null;
  if (!isAuthenticated) {
    return <Login />;
  }
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard onNavigate={(p) => setCurrentPage(p as Page)} />;
      case 'products': return <Products onAddProduct={() => { setEditingProduct(null); setCurrentPage('add-product'); }} onEditProduct={(p) => { setEditingProduct(p); setCurrentPage('edit-product'); }} />;
      case 'product-evaluation': return <ProductEvaluation />;
      case 'add-product': return <AddProduct onBack={() => setCurrentPage('products')} />;
      case 'edit-product': return <AddProduct onBack={() => setCurrentPage('products')} editProduct={editingProduct} />;
      case 'history': return <Sales />;
      case 'customers': return <Customers onAddCustomer={() => { setEditingCustomer(null); setCurrentPage('add-customer'); }} onEditCustomer={(c) => { setEditingCustomer(c); setCurrentPage('edit-customer'); }} />;
      case 'add-customer': return <AddCustomer onBack={() => setCurrentPage('customers')} />;
      case 'edit-customer': return <AddCustomer onBack={() => setCurrentPage('customers')} editCustomer={editingCustomer} />;
      case 'reservations': return <Reservations />;
      case 'returns': return <Returns />;
      case 'transfer': return <DataTransfer />;
      case 'diagnostics': return <Diagnostics />;
      case 'wipe': return <PhoneWipe onNavigate={(p) => setCurrentPage(p as Page)} />;
      case 'pos': return <Checkout scannedProduct={scannedProduct} scannedVariant={scannedVariant} onScanHandled={() => { setScannedProduct(null); setScannedVariant(null); }} />;
      case 'profile': return <Profile />;
      case 'logs': return <Logs onBack={() => setCurrentPage('dashboard')} />;
      default: return <Dashboard onNavigate={(p) => setCurrentPage(p as Page)} />;
    }
  };
  return (
    <>
      <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
        {renderPage()}
      </Layout>
      <GlobalToaster />
    </>
  );
}

/** Single app-wide sonner toaster, themed to match the current light/dark + RTL mode. */
function GlobalToaster() {
  const { isRTL } = useI18n();
  return (
    <Toaster
      position={isRTL ? 'bottom-left' : 'bottom-right'}
      theme="dark"
      richColors
      closeButton
    />
  );
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <BrandingProvider>
            <AuthProvider>
              <AppContent />
            </AuthProvider>
          </BrandingProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
