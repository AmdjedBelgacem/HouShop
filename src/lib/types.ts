export interface User {
  id: number;
  username: string;
  role: string;
  created_at: string;
  updated_at: string;
}
export interface LoginRequest {
  username: string;
  password: string;
}
export interface LoginResponse {
  user: User;
  token: string;
}
export interface Category {
  id: number;
  name: string;
  created_at: string;
}
export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  /** Aggregate (sum of variant stock). Source of truth is the variants. */
  quantity: number;
  /** "From" price — min cost across variants. */
  cost_price: number;
  /** "From" price — min selling price across variants. */
  selling_price: number;
  /** First non-null variant barcode (display only). */
  barcode: string | null;
  image_path: string | null;
  description: string | null;
  sku: string | null;
  low_stock_threshold: number;
  /** Number of variants this product has. */
  variant_count: number;
  created_at: string;
  updated_at: string;
}
/** A variant as supplied when creating/updating a product.
 *  `id` is set only when editing an existing variant; omit for new ones. */
export interface VariantInput {
  id?: number;
  variant_name: string;
  condition_note?: string | null;
  quantity?: number;
  cost_price: number;
  selling_price: number;
  barcode?: string | null;
  sku?: string | null;
  image_path?: string | null;
  low_stock_threshold?: number;
}
export interface CreateProduct {
  name: string;
  category_id: number | null;
  description?: string | null;
  image_path?: string | null;
  /** ≥1 variant is required — a product with no variants is unsellable. */
  variants: VariantInput[];
}
export interface UpdateProduct {
  id: number;
  name: string;
  category_id: number | null;
  description?: string | null;
  image_path?: string | null;
  /** Full desired set of variants; existing ones not listed are deleted. */
  variants: VariantInput[];
}
export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  photo_path: string | null;
  party_type: 'customer' | 'supplier' | 'both';
  created_at: string;
  updated_at: string;
}
export interface CreateCustomer {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  photo_path?: string | null;
  party_type?: string;
}
export interface UpdateCustomer {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  photo_path?: string | null;
  party_type?: string;
}
export interface CartItem {
  product_id: number;
  variant_id?: number | null;
  variant_name?: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  warranty_months?: number | null;
}
export interface CreateSale {
  items: CartItem[];
  customer_id: number | null;
  payment_method?: string;
  notes?: string | null;
}
export interface Sale {
  id: number;
  customer_id: number | null;
  total_amount: number;
  total_cost: number;
  profit: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
}
export interface SaleItemWithProduct {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  product_image: string | null;
  variant_id: number | null;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  subtotal: number;
}
export interface SaleWithItems {
  sale: Sale;
  items: SaleItemWithProduct[];
}
export interface InventoryTransaction {
  id: number;
  product_id: number;
  quantity: number;
  transaction_type: string;
  unit_cost: number;
  total_cost: number;
  supplier_id: number | null;
  notes: string | null;
  created_at: string;
}
export interface CreateInventoryTransaction {
  product_id: number;
  /** Stock lives on variants, so restocking targets a specific variant. */
  variant_id?: number | null;
  quantity: number;
  transaction_type?: string;
  unit_cost: number;
  supplier_id?: number | null;
  notes?: string | null;
}
export interface DashboardStats {
  total_products: number;
  low_stock_count: number;
  today_sales: number;
  today_profit: number;
  today_transactions: number;
  total_customers: number;
}
export interface SalesSummary {
  total_sales: number;
  total_transactions: number;
  avg_transaction: number;
  pending_count: number;
  pending_amount: number;
}
export interface CustomerWithStats {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  photo_path: string | null;
  party_type: 'customer' | 'supplier' | 'both';
  created_at: string;
  updated_at: string;
  order_count: number;
  total_spent: number;
  last_order_date: string | null;
}
export interface CustomerStats {
  total_customers: number;
  new_this_month: number;
  avg_lifetime_value: number;
}
export interface DailyReport {
  date: string;
  total_sales: number;
  total_cost: number;
  total_profit: number;
  total_transactions: number;
  items_sold: number;
}
export interface CartDisplayItem {
  product: Product;
  quantity: number;
}
export interface ProductVariant {
  id: number;
  product_id: number;
  variant_name: string;
  condition_note: string | null;
  quantity: number;
  cost_price: number;
  selling_price: number;
  barcode: string | null;
  sku: string | null;
  image_path: string | null;
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
}
/**
 * Result of a barcode lookup. `variant` is set when the scanned barcode belongs
 * to a specific variant (not the product itself), so checkout can auto-select it.
 * `product` is nested to keep the IPC JSON shape simple and stable.
 */
export interface BarcodeLookup {
  product: Product;
  variant: ProductVariant | null;
}
export interface Reservation {
  id: number;
  customer_id: number;
  product_id: number;
  variant_id: number | null;
  quantity: number;
  deposit_amount: number;
  total_price: number;
  remaining_amount: number;
  status: 'active' | 'completed' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface CreateReservation {
  customer_id: number;
  product_id: number;
  variant_id?: number | null;
  quantity?: number;
  deposit_amount: number;
  total_price: number;
  notes?: string | null;
}
export interface ReservationWithDetails {
  id: number;
  customer_id: number;
  customer_name: string;
  product_id: number;
  product_name: string;
  variant_id: number | null;
  variant_name: string | null;
  quantity: number;
  deposit_amount: number;
  total_price: number;
  remaining_amount: number;
  status: 'active' | 'completed' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface ReservationStats {
  active_count: number;
  total_deposits: number;
  pending_completion: number;
  cancelled_count: number;
}
