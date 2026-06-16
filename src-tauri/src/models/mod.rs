use serde::{Deserialize, Serialize};
use sqlx::FromRow;
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub role: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub user: User,
    pub token: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}
#[derive(Debug, Deserialize)]
pub struct CreateCategory {
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Product {
    pub id: i64,
    pub name: String,
    pub category_id: Option<i64>,
    pub quantity: i64,
    pub cost_price: f64,
    pub selling_price: f64,
    pub barcode: Option<String>,
    pub image_path: Option<String>,
    pub description: Option<String>,
    pub sku: Option<String>,
    pub low_stock_threshold: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProductWithCategory {
    pub id: i64,
    pub name: String,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub quantity: i64,
    pub cost_price: f64,
    pub selling_price: f64,
    pub barcode: Option<String>,
    pub image_path: Option<String>,
    pub description: Option<String>,
    pub sku: Option<String>,
    pub low_stock_threshold: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
pub struct CreateProduct {
    pub name: String,
    pub category_id: Option<i64>,
    pub quantity: Option<i64>,
    pub cost_price: f64,
    pub selling_price: f64,
    pub barcode: Option<String>,
    pub image_path: Option<String>,
    pub description: Option<String>,
    pub sku: Option<String>,
    pub low_stock_threshold: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct UpdateProduct {
    pub id: i64,
    pub name: String,
    pub category_id: Option<i64>,
    pub cost_price: f64,
    pub selling_price: f64,
    pub barcode: Option<String>,
    pub image_path: Option<String>,
    pub description: Option<String>,
    pub sku: Option<String>,
    pub low_stock_threshold: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Customer {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub photo_path: Option<String>,
    pub party_type: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
pub struct CreateCustomer {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub photo_path: Option<String>,
    pub party_type: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct UpdateCustomer {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub photo_path: Option<String>,
    pub party_type: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Sale {
    pub id: i64,
    pub customer_id: Option<i64>,
    pub total_amount: f64,
    pub total_cost: f64,
    pub profit: f64,
    pub payment_method: String,
    pub notes: Option<String>,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[allow(dead_code)]
pub struct SaleItem {
    pub id: i64,
    pub sale_id: i64,
    pub product_id: i64,
    pub quantity: i64,
    pub unit_price: f64,
    pub unit_cost: f64,
    pub subtotal: f64,
}
#[derive(Debug, Deserialize)]
pub struct CartItem {
    pub product_id: i64,
    pub variant_id: Option<i64>,
    pub variant_name: Option<String>,
    pub quantity: i64,
    pub unit_price: f64,
    pub unit_cost: f64,
    #[allow(dead_code)]
    pub warranty_months: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct CreateSale {
    pub items: Vec<CartItem>,
    pub customer_id: Option<i64>,
    pub payment_method: Option<String>,
    pub notes: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct SaleWithItems {
    pub sale: Sale,
    pub items: Vec<SaleItemWithProduct>,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SaleItemWithProduct {
    pub id: i64,
    pub sale_id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub product_image: Option<String>,
    pub variant_id: Option<i64>,
    pub variant_name: Option<String>,
    pub quantity: i64,
    pub unit_price: f64,
    pub unit_cost: f64,
    pub subtotal: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InventoryTransaction {
    pub id: i64,
    pub product_id: i64,
    pub quantity: i64,
    pub transaction_type: String,
    pub unit_cost: f64,
    pub total_cost: f64,
    pub supplier_id: Option<i64>,
    pub notes: Option<String>,
    pub created_at: String,
}
#[derive(Debug, Deserialize)]
pub struct CreateInventoryTransaction {
    pub product_id: i64,
    pub quantity: i64,
    pub transaction_type: Option<String>,
    pub unit_cost: f64,
    pub supplier_id: Option<i64>,
    pub notes: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct DailyReport {
    pub date: String,
    pub total_sales: f64,
    pub total_cost: f64,
    pub total_profit: f64,
    pub total_transactions: i64,
    pub items_sold: i64,
}
#[derive(Debug, Serialize)]
pub struct DashboardStats {
    pub total_products: i64,
    pub low_stock_count: i64,
    pub today_sales: f64,
    pub today_profit: f64,
    pub today_transactions: i64,
    pub total_customers: i64,
}
#[derive(Debug, Serialize)]
pub struct SalesSummary {
    pub total_sales: f64,
    pub total_transactions: i64,
    pub avg_transaction: f64,
    pub pending_count: i64,
    pub pending_amount: f64,
}
#[derive(Debug, Serialize, FromRow)]
pub struct CustomerWithStats {
    pub id: i64,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub photo_path: Option<String>,
    pub party_type: String,
    pub created_at: String,
    pub updated_at: String,
    pub order_count: i64,
    pub total_spent: f64,
    pub last_order_date: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct CustomerStats {
    pub total_customers: i64,
    pub new_this_month: i64,
    pub avg_lifetime_value: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProductVariant {
    pub id: i64,
    pub product_id: i64,
    pub variant_name: String,
    pub condition_note: Option<String>,
    pub quantity: i64,
    pub cost_price: f64,
    pub selling_price: f64,
    pub barcode: Option<String>,
    pub sku: Option<String>,
    pub image_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
pub struct CreateVariant {
    pub product_id: i64,
    pub variant_name: String,
    pub condition_note: Option<String>,
    pub quantity: Option<i64>,
    pub cost_price: f64,
    pub selling_price: f64,
    pub barcode: Option<String>,
    pub sku: Option<String>,
    pub image_path: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct UpdateVariant {
    pub id: i64,
    pub variant_name: String,
    pub condition_note: Option<String>,
    pub quantity: Option<i64>,
    pub cost_price: f64,
    pub selling_price: f64,
    pub barcode: Option<String>,
    pub sku: Option<String>,
    pub image_path: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Reservation {
    pub id: i64,
    pub customer_id: i64,
    pub product_id: i64,
    pub variant_id: Option<i64>,
    pub quantity: i64,
    pub deposit_amount: f64,
    pub total_price: f64,
    pub remaining_amount: f64,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Deserialize)]
pub struct CreateReservation {
    pub customer_id: i64,
    pub product_id: i64,
    pub variant_id: Option<i64>,
    pub quantity: Option<i64>,
    pub deposit_amount: f64,
    pub total_price: f64,
    pub notes: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ReservationWithDetails {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub product_id: i64,
    pub product_name: String,
    pub variant_id: Option<i64>,
    pub variant_name: Option<String>,
    pub quantity: i64,
    pub deposit_amount: f64,
    pub total_price: f64,
    pub remaining_amount: f64,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Serialize)]
pub struct ReservationStats {
    pub active_count: i64,
    pub total_deposits: f64,
    pub pending_completion: i64,
    pub cancelled_count: i64,
}
