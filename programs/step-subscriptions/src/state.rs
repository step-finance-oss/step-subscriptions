use super::errors::ErrorCode;
use anchor_lang::prelude::*;

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

    // Version 1 uses reserved[0] as a tag and [1..9] as a LE u64 counter.
    // It survives bounded-history eviction without changing the account layout.
    pub fn add_permanent_quantity(&mut self, quantity: u8, max_owned: u8) -> Result<()> {
        require_gt!(quantity, 0, ErrorCode::InvalidPurchaseQty);
        let owned = match self.reserved[0] {
            1 => u64::from_le_bytes(self.reserved[1..9].try_into().unwrap()),
            0 if self.history_10.len() < 10 => self
                .history_10
                .iter()
                .map(|entry| u64::from(entry.quantity))
                .sum(),
            // Ten entries may already have lost older receipts. Never guess.
            _ => return err!(ErrorCode::PurchaseMigrationRequired),
        };
        let next = owned
            .checked_add(u64::from(quantity))
            .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
        require_gte!(u64::from(max_owned), next, ErrorCode::MaxPurchaseQtyReached);
        self.reserved[0] = 1;
        self.reserved[1..9].copy_from_slice(&next.to_le_bytes());
        Ok(())
    }

    pub fn history_totals(&self) -> Result<(u64, u64)> {
        self.history_10
            .iter()
            .try_fold((0_u64, 0_u64), |(revenue, quantity), entry| {
                Ok((
                    revenue
                        .checked_add(entry.amount_paid)
                        .ok_or(error!(ErrorCode::ArithmeticOverflow))?,
                    quantity + u64::from(entry.quantity),
                ))
            })
    }

    // Each target can apply a cumulative pool of permanent cash payments only
    // once. Later claims must include the cumulative source pool, as tier
    // upgrades already do. [9] is its version; [10..18] is the credited u64.
    pub fn permanent_upgrade_credit(&mut self, pool: u64) -> Result<u64> {
        if self.reserved[9] == 0 {
            if !self.history_10.is_empty() {
                require_eq!(pool, 0, ErrorCode::PurchaseMigrationRequired);
                return Ok(0);
            }
            self.reserved[9] = 1;
        }
        require_eq!(self.reserved[9], 1, ErrorCode::PurchaseMigrationRequired);
        let credited = u64::from_le_bytes(self.reserved[10..18].try_into().unwrap());
        let additional = pool.saturating_sub(credited);
        if additional > 0 {
            self.reserved[10..18].copy_from_slice(&pool.to_le_bytes());
        }
        Ok(additional)
    }

    // [18] versions lifetime cash [19..27] and quantity [27..35]. These
    // totals survive receipt eviction and contain actual cash, never credits.
    pub fn payment_totals(&self) -> Result<(u64, u64)> {
        match self.reserved[18] {
            1 => Ok((
                u64::from_le_bytes(self.reserved[19..27].try_into().unwrap()),
                u64::from_le_bytes(self.reserved[27..35].try_into().unwrap()),
            )),
            0 if self.history_10.len() < 10 => self.history_totals(),
            _ => err!(ErrorCode::PurchaseMigrationRequired),
        }
    }

    pub fn record_payment(&mut self, amount: u64, quantity: u8) -> Result<()> {
        require_gt!(quantity, 0, ErrorCode::InvalidPurchaseQty);
        if self.reserved[18] == 0 && self.history_10.len() >= 10 {
            // Keep legacy cash-only renewals available without inventing lost
            // accounting. Credit or revenue reversal still requires migration.
            return Ok(());
        }
        let (paid, qty) = self.payment_totals()?;
        let paid = paid
            .checked_add(amount)
            .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
        let qty = qty
            .checked_add(u64::from(quantity))
            .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
        self.reserved[18] = 1;
        self.reserved[19..27].copy_from_slice(&paid.to_le_bytes());
        self.reserved[27..35].copy_from_slice(&qty.to_le_bytes());
        Ok(())
    }

    pub fn total_active(&self, purchase_duration_secs: Option<i64>) -> Result<u64> {
        Ok(self.total_active_at(purchase_duration_secs, Clock::get()?.unix_timestamp))
    }

    pub(crate) fn total_active_at(&self, duration: Option<i64>, now: i64) -> u64 {
        if self.history_10.is_empty() {
            return 0;
        }
        if let Some(duration) = duration {
            if duration <= 0 {
                return 0;
            }
            let remaining = (i128::from(self.expires_ts) - i128::from(now)).max(0);
            // A partly elapsed unit remains active until its period ends.
            ((remaining + i128::from(duration) - 1) / i128::from(duration)) as u64
        } else if self.reserved[0] == 1 {
            u64::from_le_bytes(self.reserved[1..9].try_into().unwrap())
        } else {
            self.history_10.iter().map(|h| u64::from(h.quantity)).sum()
        }
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

    // Sticky across admin deletion/revenue adjustments. Existing counters also
    // lock legacy products that predate this reserved-byte flag.
    pub fn mark_purchased(&mut self) {
        self.reserved[0] = 1;
    }

    pub fn can_change_mint(&self) -> bool {
        self.reserved[0] == 0 && self.purchase_qty == 0 && self.purchase_revenue == 0
    }

    pub fn validate_economics(&self) -> Result<()> {
        require_gt!(self.max_owned, 0, ErrorCode::InvalidMaxOwned);
        if let Some(duration) = self.purchase_duration_secs {
            require!(
                duration > 0 && duration.checked_mul(i64::from(self.max_owned)).is_some(),
                ErrorCode::InvalidPurchaseDuration
            );
        }
        require!(
            self.discount_bps <= 10_000 && self.qty_for_discount > 0,
            ErrorCode::InvalidDiscount
        );
        Ok(())
    }

    pub fn payment_amount(&self, quantity: u8, credit: u64) -> Result<u64> {
        self.validate_economics()?;
        require_gt!(quantity, 0, ErrorCode::InvalidPurchaseQty);
        let gross = self
            .cost
            .checked_mul(u64::from(quantity))
            .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
        require_gte!(gross, credit, ErrorCode::DowngradesNotSupported);
        let net = gross - credit;
        let discount = if quantity >= self.qty_for_discount {
            (u128::from(net) * u128::from(self.discount_bps) / 10_000) as u64
        } else {
            0
        };
        Ok(net - discount)
    }

    pub fn purchase_expiry(&self, previous: i64, quantity: u8, now: i64) -> Result<i64> {
        self.validate_economics()?;
        require_gt!(quantity, 0, ErrorCode::InvalidPurchaseQty);
        if let Some(duration) = self.purchase_duration_secs {
            let remaining = (i128::from(previous) - i128::from(now)).max(0);
            let extension = i128::from(duration) * i128::from(quantity);
            require_gte!(
                i128::from(duration) * i128::from(self.max_owned),
                remaining + extension,
                ErrorCode::MaxPurchaseQtyReached
            );
            i64::try_from(i128::from(previous.max(now)) + extension)
                .map_err(|_| error!(ErrorCode::ArithmeticOverflow))
        } else {
            Ok(i64::MAX)
        }
    }

    pub fn record_sale(&mut self, amount: u64, quantity: u8) -> Result<()> {
        let revenue = self
            .purchase_revenue
            .checked_add(amount)
            .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
        let qty = self
            .purchase_qty
            .checked_add(u64::from(quantity))
            .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
        self.purchase_revenue = revenue;
        self.purchase_qty = qty;
        self.mark_purchased();
        Ok(())
    }

    pub fn validate(&mut self) -> Result<()> {
        self.validate_economics()?;
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
