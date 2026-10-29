use super::errors::ErrorCode;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::{self};

pub const PRODUCT_NAME_LENGTH_MAX: usize = 32;
pub const PRODUCT_NAME_LENGTH_MIN: usize = 4;
pub const PRODUCT_BLURB_LENGTH_MAX: usize = 128;
pub const PRODUCT_BLURB_LENGTH_MIN: usize = 0;
pub const PRODUCT_FAMILY_LENGTH_MAX: usize = 32;
pub const PRODUCT_FAMILY_LENGTH_MIN: usize = 0;
pub const PRODUCT_UPGRADE_GRP_LENGTH_MAX: usize = 32;
pub const PRODUCT_UPGRADE_GRP_LENGTH_MIN: usize = 0;
pub const PRODUCT_CODE_LENGTH_MAX: usize = 16;
pub const PRODUCT_CODE_LENGTH_MIN: usize = 3;
pub const PRODUCT_ROLE_LENGTH_MAX: usize = 10;
pub const PRODUCT_ROLE_LENGTH_MIN: usize = 3;
pub const PRODUCT_ROLE_ARRAY_LENGTH: usize = 10;
pub const PRODUCT_STR_LENGTH_MAX: usize = 20;
pub const PRODUCT_STR_20_A5_ARRAY_LENGTH: usize = 5;
pub const PRODUCT_STR_20_A5_LENGTH_MIN: usize = 0;
pub const PRODUCT_STR_20_A5_LENGTH_MAX: usize = 20;

/// Global state stores settings needed by the program
#[account]
pub struct GlobalState {
    pub bump: u8,
    pub payment_wallet: Pubkey,
    pub authorities: [Pubkey; 2],

    pub reserved: [u8; 64],
}
impl GlobalState {
    pub const SIZE: usize = 1 + 32 + (2 * 32) + (64);

    pub fn is_authorized(&self, authority: Pubkey) -> bool {
        return self.authorities.iter().any(|a| *a == authority);
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PurchaseHistory {
    pub amount_paid: u64,
    pub quantity: u8,
    pub purchased_ts: i64,
    pub refunded: Option<u64>,
}

impl PurchaseHistory {
    pub const SIZE: usize = 8 + 1 + 8 + 1 + 8;
}

#[account]
pub struct Purchase {
    pub bump: u8,
    pub owner: Pubkey,
    pub product: Pubkey,
    pub regarding: Pubkey,
    pub expires_ts: i64,
    pub history_10: Vec<PurchaseHistory>,
    pub reserved: [u8; 64],
}

impl Purchase {
    pub const SIZE: usize = 1 + 32 + 32 + 32 + 8 + ((PurchaseHistory::SIZE * 10) + 4) + (64);

    pub fn add_history(&mut self, history: PurchaseHistory) {
        self.history_10.push(history);
        if self.history_10.len() > 10 {
            self.history_10.remove(0);
        }
    }

    pub fn total_active(&self, purchase_duration_secs: Option<i64>) -> u8 {
        let mut total = 0;
        let current_time = sysvar::clock::Clock::get().unwrap().unix_timestamp;
        let mut current_end_date = self.expires_ts;
        // find non expired purchases
        'outer: for history in self.history_10.iter().rev() {
            if let Some(purchase_duration_secs) = purchase_duration_secs {
                for _ in 0..history.quantity {
                    current_end_date -= purchase_duration_secs;
                    if current_end_date < current_time {
                        break 'outer; // expired
                    }
                    total += 1;
                }
            } else {
                total += history.quantity;
            }
        }
        total
    }
}

#[account]
pub struct Product {
    pub bump: u8,
    pub active: bool,
    pub code_16: String,
    pub name_32: String,
    pub blurb_128: String,
    pub family_32: String,
    pub upgrade_group_32: Option<String>,
    pub created_ts: i64,
    pub cost_mint: Pubkey,
    pub cost: u64,
    pub discount_bps: u64,
    pub qty_for_discount: u8,
    pub purchase_duration_secs: Option<i64>,
    pub max_owned: u8,
    pub total_paid: i64,
    pub assigned_roles_6_a10: Vec<String>,
    pub i64_a5: [i64; 5],
    pub str_20_a5: Vec<String>,
    pub purchase_qty: u64,
    pub purchase_revenue: u64,
    pub reserved: [u8; 240],
}

impl Product {
    pub const SIZE: usize = 1
        + PRODUCT_CODE_LENGTH_MAX + 4
        + PRODUCT_NAME_LENGTH_MAX + 4
        + PRODUCT_BLURB_LENGTH_MAX + 4
        + PRODUCT_FAMILY_LENGTH_MAX + 4
        + 1 + PRODUCT_UPGRADE_GRP_LENGTH_MAX + 4
        + 8 // created_ts
        + 32 // cost_mint
        + 8 // cost
        + 8 // discount_bps
        + 1 // qty_for_discount
        + 1 + 8 // purchase_duration_secs
        + 1 // max_owned
        + 8 // total_paid
        + ((PRODUCT_ROLE_LENGTH_MAX + 4) * 10) + 4 // assigned_roles_6_a10
        + 1
        + (8 * 5)
        + ((PRODUCT_STR_LENGTH_MAX + 4) * 5) + 4 // str_20_a5
        + (256);

    pub fn validate(&mut self) -> Result<()> {
        //checks
        let code = self.code_16.trim();
        require_gte!(
            PRODUCT_CODE_LENGTH_MAX,
            code.len(),
            ErrorCode::InvalidLengthCode
        );
        require_gte!(
            code.len(),
            PRODUCT_CODE_LENGTH_MIN,
            ErrorCode::InvalidLengthCode
        );
        require!(
            code.chars().all(|a| a.is_ascii_alphanumeric() || a == '-'),
            ErrorCode::InvalidCharsInCode
        );

        let name = self.name_32.trim();
        require_gte!(
            PRODUCT_NAME_LENGTH_MAX,
            name.len(),
            ErrorCode::InvalidLengthName
        );
        require_gte!(
            name.len(),
            PRODUCT_NAME_LENGTH_MIN,
            ErrorCode::InvalidLengthName
        );
        require!(
            name.chars().all(|a| a.is_ascii_alphanumeric() || a == ' '),
            ErrorCode::InvalidCharsInName
        );

        let blurb = self.blurb_128.trim();
        require_gte!(
            PRODUCT_BLURB_LENGTH_MAX,
            blurb.len(),
            ErrorCode::InvalidLengthBlurb
        );
        require_gte!(
            blurb.len(),
            PRODUCT_BLURB_LENGTH_MIN,
            ErrorCode::InvalidLengthBlurb
        );

        let family = self.family_32.trim();
        require_gte!(
            PRODUCT_FAMILY_LENGTH_MAX,
            family.len(),
            ErrorCode::InvalidLengthFamily
        );
        require_gte!(
            family.len(),
            PRODUCT_FAMILY_LENGTH_MIN,
            ErrorCode::InvalidLengthFamily
        );

        if let Some(upgrade_group) = &self.upgrade_group_32 {
            require_gte!(
                PRODUCT_UPGRADE_GRP_LENGTH_MAX,
                upgrade_group.len(),
                ErrorCode::InvalidLengthUpgradeGroup
            );
            require_gte!(
                upgrade_group.len(),
                PRODUCT_UPGRADE_GRP_LENGTH_MIN,
                ErrorCode::InvalidLengthUpgradeGroup
            );
        }

        let assigned_roles = &self.assigned_roles_6_a10;
        require_gte!(
            PRODUCT_ROLE_ARRAY_LENGTH,
            assigned_roles.len(),
            ErrorCode::InvalidRoleCount
        );

        for role in assigned_roles.iter() {
            require_gte!(
                PRODUCT_ROLE_LENGTH_MAX,
                role.len(),
                ErrorCode::InvalidLengthRole
            );
            require_gte!(
                role.len(),
                PRODUCT_ROLE_LENGTH_MIN,
                ErrorCode::InvalidLengthRole
            );
        }

        let str_20_a5 = &self.str_20_a5;
        require_gte!(
            PRODUCT_STR_20_A5_ARRAY_LENGTH,
            str_20_a5.len(),
            ErrorCode::InvalidStr20A5Count
        );

        for str in str_20_a5.iter() {
            require_gte!(
                PRODUCT_STR_20_A5_LENGTH_MAX,
                str.len(),
                ErrorCode::InvalidLengthCode
            );
            require_gte!(
                str.len(),
                PRODUCT_STR_20_A5_LENGTH_MIN,
                ErrorCode::InvalidLengthCode
            );
        }

        //assignments
        self.code_16 = code.to_string();
        self.name_32 = name.to_string();
        self.blurb_128 = blurb.to_string();
        self.family_32 = family.to_string();

        Ok(())
    }
}
