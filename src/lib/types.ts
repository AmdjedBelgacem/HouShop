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
/** Input for recording a customer return against a line of a past sale. */
export interface CreateReturn {
  sale_id: number;
  sale_item_id: number;
  product_id: number;
  variant_id: number | null;
  quantity: number;
  refund_amount: number;
  reason: string | null;
}
/** A recorded return joined with display context (returned by get_returns). */
export interface ReturnWithDetails {
  id: number;
  sale_id: number;
  sale_item_id: number;
  product_id: number;
  variant_id: number | null;
  quantity: number;
  refund_amount: number;
  reason: string | null;
  created_at: string;
  product_name: string;
  variant_name: string | null;
  customer_name: string | null;
}
export interface ReturnsSummary {
  total_returns: number;
  total_refunded: number;
  units_returned: number;
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
export interface InventoryValuationVariant {
  id: number;
  variant_name: string;
  quantity: number;
  unit_cost: number;
  unit_price: number;
  total_cost: number;
  projected_revenue: number;
  projected_profit: number;
}
export interface InventoryValuationProduct {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  quantity: number;
  total_cost: number;
  projected_revenue: number;
  projected_profit: number;
  variants: InventoryValuationVariant[];
}
export interface InventoryValuationCategory {
  id: number | null;
  name: string;
  quantity: number;
  total_cost: number;
  projected_revenue: number;
  projected_profit: number;
  products: InventoryValuationProduct[];
}
export interface InventoryValuationSummary {
  quantity: number;
  total_cost: number;
  projected_revenue: number;
  projected_profit: number;
  categories: InventoryValuationCategory[];
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

// ============================================================================
// HouSwitch Phone Data Transfer Types
// ============================================================================

export type DevicePlatform = 'android' | 'ios' | 'harmonyos';
export type ConnectionType = 'usb' | 'wifi' | 'virtual';
export type DeviceConnectionState = 'connected' | 'unauthorized' | 'offline' | 'locked' | 'need_trust' | 'mtp_only';

export type TransferCategory =
  | 'contacts'
  | 'messages'
  | 'calls'
  | 'calendars'
  | 'photos'
  | 'videos'
  | 'audio'
  | 'documents';

export interface DeviceCapabilities {
  can_read_contacts: boolean;
  can_write_contacts: boolean;
  can_read_messages: boolean;
  can_write_messages: boolean;
  can_read_calls: boolean;
  can_write_calls: boolean;
  can_read_calendars: boolean;
  can_write_calendars: boolean;
  can_read_media: boolean;
  can_write_media: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  brand: string;
  model: string;
  platform: DevicePlatform;
  os_version: string;
  connection_type: ConnectionType;
  connection_state: DeviceConnectionState;
  battery_level: number | null;
  is_charging: boolean | null;
  storage_total_bytes: number;
  storage_free_bytes: number;
  capabilities: DeviceCapabilities;
  is_virtual: boolean;
}

export interface CategoryScanResult {
  category: TransferCategory;
  item_count: number;
  total_bytes: number;
  available: boolean;
  note: string | null;
}

export interface DeviceDataSummary {
  device_id: string;
  categories: CategoryScanResult[];
  total_items: number;
  total_bytes: number;
}

export type TransferStatus = 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface TransferSessionRecord {
  id: number;
  session_uuid: string;
  source_device_id: string;
  source_device_name: string;
  source_platform: string;
  target_device_id: string;
  target_device_name: string;
  target_platform: string;
  status: TransferStatus;
  total_items: number;
  transferred_items: number;
  total_bytes: number;
  transferred_bytes: number;
  selected_categories: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface TransferLogRecord {
  id: number;
  session_id: number;
  category: string;
  item_name: string;
  item_size: number;
  status: 'pending' | 'in_progress' | 'success' | 'skipped' | 'failed';
  error_message: string | null;
  checksum: string | null;
  created_at: string;
}

export interface StartTransferRequest {
  source_device_id: string;
  target_device_id: string;
  categories: string[];
}

export interface TransferProgressEvent {
  session_uuid: string;
  status: TransferStatus;
  current_category: TransferCategory | null;
  current_item_name: string | null;
  current_item_index: number;
  total_items: number;
  transferred_bytes: number;
  total_bytes: number;
  progress_percentage: number;
  speed_bytes_per_sec: number;
  speed_mbps: number;
  eta_seconds: number;
  elapsed_seconds: number;
  error_message: string | null;
}

export interface CategoryTransferSummary {
  category: TransferCategory;
  transferred_count: number;
  failed_count: number;
  total_bytes: number;
}

export interface TransferSummaryReport {
  session_id: number;
  session_uuid: string;
  source_device_name: string;
  source_platform: string;
  target_device_name: string;
  target_platform: string;
  status: TransferStatus;
  total_items: number;
  transferred_items: number;
  skipped_items: number;
  failed_items: number;
  total_bytes: number;
  transferred_bytes: number;
  duration_seconds: number;
  average_speed_mbps: number;
  categories_breakdown: CategoryTransferSummary[];
}

export interface WifiServerInfo {
  ip_address: string;
  port: number;
  pin: string;
  qr_code_svg: string;
  qr_code_data_url: string;
  connect_url: string;
  active_connections: number;
}


// --- HouCheck Diagnostics System Types ---
export type ComponentStatus =
  | 'original'
  | 'replaced_oem'
  | 'replaced_third_party'
  | 'defective'
  | 'unknown';

export interface PartAuditItem {
  name: string;
  status: ComponentStatus;
  read_serial?: string | null;
  factory_serial?: string | null;
  is_original: boolean;
  note?: string | null;
}

export interface PartsAuditReport {
  screen: PartAuditItem;
  battery: PartAuditItem;
  rear_camera: PartAuditItem;
  front_camera: PartAuditItem;
  biometrics: PartAuditItem;
  logic_board: PartAuditItem;
}

export interface BatteryGasGauge {
  health_percentage: number;
  cycle_count: number;
  design_capacity_mah: number;
  actual_capacity_mah: number;
  /** null when the device doesn't expose a battery temperature. */
  temperature_celsius: number | null;
  serial_number?: string | null;
  manufacturer?: string | null;
  status: ComponentStatus;
  current_charge_percentage?: number | null;
  is_charging?: boolean | null;
  /** True when health/capacity couldn't be read and were estimated from cycles. */
  estimated?: boolean;
}

export interface SecurityLockStatus {
  icloud_fmi_locked: boolean;
  fmi_account_masked?: string | null;
  fmi_on?: boolean;
  mdm_enrolled: boolean;
  carrier_locked: boolean;
  carrier_name?: string | null;
  knox_tripped: boolean;
  frp_locked: boolean;
  bootloader_unlocked: boolean;
  is_rooted_or_jailbroken: boolean;
}

export interface HardwareTestResult {
  key: string;
  name: string;
  category: string;
  passed: boolean;
  tested: boolean;
  details?: string | null;
}

export type DeviceGrade = 'A+' | 'A' | 'B' | 'C' | 'Defective';

export interface GradingResult {
  score: number;
  grade: DeviceGrade;
  passed_count: number;
  total_count: number;
  valuation_multiplier: number;
  summary: string;
  defects: string[];
  /** Hardware tests not run yet; they don't lower the score. */
  pending_tests?: number;
  /** True while tests are pending: the grade is an estimate, capped at B. */
  provisional?: boolean;
}

export interface FullDeviceDiagnosticReport {
  device_id: string;
  device_name: string;
  brand: string;
  model: string;
  platform: string;
  os_version: string;
  imei1?: string | null;
  imei2?: string | null;
  serial_number?: string | null;
  baseband_version?: string | null;
  cpu_architecture: string;
  ram_gb: number;
  storage_total_bytes: number;
  storage_free_bytes: number;
  battery: BatteryGasGauge;
  parts_audit: PartsAuditReport;
  security_locks: SecurityLockStatus;
  hardware_tests: Record<string, HardwareTestResult>;
  grading: GradingResult;
  /** 'mtp' when only basic details could be read (USB debugging is off). */
  limited_reason?: string | null;
}

export interface DeviceInspectionRecord {
  id: number;
  inspection_uuid: string;
  device_id: string;
  device_name: string;
  brand: string;
  model: string;
  platform: string;
  os_version: string;
  imei1?: string | null;
  imei2?: string | null;
  serial_number?: string | null;
  battery_health: number;
  battery_cycles: number;
  battery_design_mah: number;
  battery_actual_mah: number;
  parts_audit: string;
  hardware_tests: string;
  score: number;
  calculated_grade: string;
  passed_tests_count: number;
  total_tests_count: number;
  lock_status: string;
  technician_notes?: string | null;
  created_at: string;
}

export interface DiagnosticServerInfo {
  ip_address: string;
  port: number;
  pin: string;
  connect_url: string;
  qr_code_svg: string;
  qr_code_data_url: string;
  connected?: boolean;
}

export interface MobileDiagnosticSyncEvent {
  test_key: string;
  passed: boolean;
  details?: string | null;
}

export interface VirtualDeviceOption {
  id: string;
  name: string;
  brand: string;
  os: string;
}

export interface ConvertToVariantRequest {
  inspection_id: number;
  product_id: number;
  variant_name?: string;
  cost_price: number;
  selling_price: number;
  quantity: number;
}

export interface ConvertToVariantResponse {
  variant_id: number;
  inspection_uuid: string;
  message: string;
}

// ==========================================
// HouWipe: Phone Sanitization & Secure Wipe Types
// ==========================================

export type WipeRiskLevel = 'safe' | 'warning' | 'critical_blocked';

export interface ActiveAccountInfo {
  account_type: 'icloud' | 'google' | 'samsung' | 'xiaomi' | 'huawei' | 'other' | string;
  account_name: string;
  identifier: string;
  action_required: string;
}

export interface WipeMethodInfo {
  id: string;
  name: string;
  description: string;
  nist_compliant: boolean;
  estimated_seconds: number;
  requires_reboot: boolean;
}

export interface PreWipeAuditResult {
  device_id: string;
  device_name: string;
  brand: string;
  model: string;
  platform: string;
  os_version: string;
  imei?: string | null;
  imei2?: string | null;
  serial_number?: string | null;
  storage_capacity?: string | null;
  battery_level?: number | null;
  is_safe_to_wipe: boolean;
  risk_level: WipeRiskLevel;
  blocking_reasons: string[];
  warning_reasons: string[];
  active_accounts: ActiveAccountInfo[];
  fmi_status: boolean;
  fmi_account_masked?: string | null;
  frp_status: boolean;
  mdm_enrolled: boolean;
  supported_wipe_methods: WipeMethodInfo[];
}

export interface WipeProgressEvent {
  step: number;
  total_steps: number;
  stage_name: string;
  progress_percent: number;
  log_line: string;
  is_complete: boolean;
  is_error: boolean;
  error_message?: string | null;
}

export interface ExecuteWipeRequest {
  device_id: string;
  platform: string;
  wipe_method: string;
  technician_name: string;
  technician_override: boolean;
  imei_confirmation_digits: string;
  customer_backup_confirmed: boolean;
  notes?: string | null;
}

export interface SanitizationRecord {
  id: number;
  wipe_uuid: string;
  device_id: string;
  device_name: string;
  brand: string;
  model: string;
  platform: string;
  os_version: string;
  imei?: string | null;
  imei2?: string | null;
  serial_number?: string | null;
  storage_capacity?: string | null;
  wipe_method: string;
  nist_standard: string;
  pre_wipe_accounts_removed: boolean;
  pre_wipe_lock_audit: unknown;
  post_wipe_oobe_verified: boolean;
  status: string;
  technician_name: string;
  notes?: string | null;
  duration_seconds: number;
  certificate_number: string;
  created_at: string;
}

export interface ConvertSanitizationToVariantRequest {
  sanitization_id: number;
  product_id: number;
  variant_name?: string;
  cost_price: number;
  selling_price: number;
  quantity: number;
}

export interface ConvertSanitizationToVariantResponse {
  variant_id: number;
  certificate_number: string;
  message: string;
}

