use anchor_lang::prelude::*;

#[event]
pub struct PurchaseEvent {
    pub product: Pubkey,
    pub purchase: Pubkey,
    pub owner: Pubkey,
    pub regarding: Pubkey,
    pub amount_paid: u64,
    pub quantity: u8,
    pub purchased_ts: i64,
    pub expires_ts: i64,
    pub upgraded: bool,
}
