use anchor_lang::prelude::*;
use anchor_spl::token::transfer;
use errors::ErrorCode;
use events::*;
use ix_accounts::*;
use upgrade::check_purchase_upgrade;

mod errors;
mod events;
mod ix_accounts;
mod state;
mod upgrade;

declare_id!("SsubM7pGA83VRnCodXVrxU2GZNBQzBYgzPUYBssCwU1");

#[program]
pub mod step_subscriptions {
    use super::*;
    use anchor_lang::solana_program::sysvar::{self};
    use anchor_spl::token::Transfer;

    pub fn initialize_program(
        ctx: Context<InitializeProgram>,
        authority: Pubkey,
        payment_wallet: Pubkey,
    ) -> Result<()> {
        let gs = &mut ctx.accounts.global_state;
        gs.bump = ctx.bumps["global_state"];
        gs.authorities[0] = authority;
        gs.authorities[1] = Pubkey::default();
        gs.payment_wallet = payment_wallet;

        Ok(())
    }

    pub fn update_state_authority(
        ctx: Context<ChangeGlobalState>,
        new_authority: Pubkey,
        idx: u32,
        allow_remove_self: bool,
    ) -> Result<()> {
        require_gt!(2, idx, ErrorCode::InvalidAuthorityUpdate);
        let gs = &mut ctx.accounts.global_state;
        require!(
            gs.authorities[idx as usize] != ctx.accounts.authority.key() || allow_remove_self,
            ErrorCode::InvalidAuthorityUpdate
        );
        gs.authorities[idx as usize] = new_authority;

        Ok(())
    }

    pub fn update_state_payment_wallet(
        ctx: Context<ChangeGlobalState>,
        new_payment_wallet: Pubkey,
    ) -> Result<()> {
        let gs = &mut ctx.accounts.global_state;
        gs.payment_wallet = new_payment_wallet;

        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    pub fn create_product(
        ctx: Context<CreateProduct>,
        code: String,
        name: String,
        blurb: String,
        family: String,
        upgrade_group: Option<String>,
        cost_mint: Pubkey,
        cost: u64,
        purchase_duration_secs: Option<i64>,
        max_owned: u8,
        assigned_roles: Vec<String>,
    ) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.bump = ctx.bumps["product"];
        product.name_32 = name;
        product.blurb_128 = blurb;
        product.family_32 = family;
        product.upgrade_group_32 = upgrade_group;
        product.code_16 = code;
        product.created_ts = sysvar::clock::Clock::get().unwrap().unix_timestamp;
        product.cost_mint = cost_mint;
        product.cost = cost;
        product.discount_bps = 0;
        product.qty_for_discount = 12;
        product.purchase_duration_secs = purchase_duration_secs;
        product.max_owned = max_owned;
        product.total_paid = 0;
        product.assigned_roles_6_a10 = assigned_roles;
        product.active = false;

        product.validate()?;

        Ok(())
    }

    pub fn update_product_active_state(ctx: Context<UpdateProduct>, active: bool) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.active = active;

        Ok(())
    }

    pub fn update_product_cost(ctx: Context<UpdateProduct>, cost: u64) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.cost = cost;

        Ok(())
    }

    pub fn update_product_mint(ctx: Context<UpdateProduct>, cost_mint: Pubkey) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.cost_mint = cost_mint;
        product.validate()?;

        Ok(())
    }

    pub fn update_product_discount(
        ctx: Context<UpdateProduct>,
        discount_bps: u64,
        qty_for_discount: u8,
    ) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.discount_bps = discount_bps;
        product.qty_for_discount = qty_for_discount;

        Ok(())
    }

    pub fn update_product_name(ctx: Context<UpdateProduct>, name: String) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.name_32 = name;
        product.validate()?;

        Ok(())
    }

    pub fn update_product_blurb(ctx: Context<UpdateProduct>, blurb: String) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.blurb_128 = blurb;
        product.validate()?;

        Ok(())
    }

    pub fn update_product_family(ctx: Context<UpdateProduct>, family: String) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.family_32 = family;
        product.validate()?;

        Ok(())
    }

    pub fn update_product_assigned_roles(
        ctx: Context<UpdateProduct>,
        assigned_roles: Vec<String>,
    ) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.assigned_roles_6_a10 = assigned_roles;
        product.validate()?;

        Ok(())
    }

    pub fn update_product_i64_a5(ctx: Context<UpdateProduct>, i64_a5: [i64; 5]) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.i64_a5 = i64_a5;
        product.validate()?;

        Ok(())
    }

    pub fn update_product_str(ctx: Context<UpdateProduct>, str_20_a5: Vec<String>) -> Result<()> {
        let product = &mut ctx.accounts.product;
        product.str_20_a5 = str_20_a5;
        product.validate()?;

        Ok(())
    }

    pub fn delete_purchase(ctx: Context<DeletePurchase>, remove_revenue: bool) -> Result<()> {
        if remove_revenue {
            let product = &mut ctx.accounts.product;
            let purchase = &ctx.accounts.purchase;

            let (rev, qty) = purchase
                .history_10
                .iter()
                .fold((0, 0), |a, e| (a.0 + e.amount_paid, a.1 + e.quantity));
            product.purchase_revenue -= rev;
            product.purchase_qty -= qty as u64;
        }
        Ok(())
    }

    pub fn purchase_product(ctx: Context<PurchaseProduct>, quantity: u8) -> Result<()> {
        let total_already_paid = std::cmp::max(0, check_purchase_upgrade(&ctx)?);

        let product = &mut ctx.accounts.product;
        let purchase = &mut ctx.accounts.purchase;

        require_gte!(
            product.max_owned,
            purchase.total_active(product.purchase_duration_secs),
            ErrorCode::MaxPurchaseQtyReached
        );

        let current_time = sysvar::clock::Clock::get().unwrap().unix_timestamp;
        let mut new_purchase_history = state::PurchaseHistory {
            amount_paid: 0,
            quantity,
            purchased_ts: current_time,
            refunded: None,
        };

        if let Some(purchase_duration_secs) = product.purchase_duration_secs {
            let max_duration = purchase_duration_secs * product.max_owned as i64;
            let duration_remaining = std::cmp::max(0, purchase.expires_ts - current_time);

            let duration_for_qty = purchase_duration_secs * (quantity as i64);
            require_gte!(
                max_duration,
                duration_remaining + duration_for_qty,
                ErrorCode::MaxPurchaseQtyReached
            );

            if purchase.expires_ts > current_time {
                purchase.expires_ts += duration_for_qty;
            } else {
                purchase.expires_ts = current_time + duration_for_qty;
            }
        } else {
            purchase.expires_ts = std::i64::MAX;
        }

        require_gte!(
            product.cost * (quantity as u64),
            total_already_paid,
            ErrorCode::DowngradesNotSupported
        );

        let mut amount_to_pay = (product.cost * (quantity as u64)) - total_already_paid;
        if amount_to_pay > 0 {
            if quantity >= product.qty_for_discount {
                amount_to_pay -= amount_to_pay * product.discount_bps / 10000;
            }
            //take payment
            transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        authority: ctx.accounts.payment_from_token_authority.to_account_info(),
                        from: ctx.accounts.payment_from_token_account.to_account_info(),
                        to: ctx.accounts.payment_to_token_account.to_account_info(),
                    },
                ),
                amount_to_pay,
            )?;

            new_purchase_history.amount_paid += amount_to_pay;
        }

        purchase.bump = ctx.bumps["purchase"];
        purchase.owner = ctx.accounts.owner.key();
        purchase.regarding = ctx.accounts.regarding.key();
        purchase.product = product.key();
        product.purchase_revenue += amount_to_pay;
        product.purchase_qty += quantity as u64;

        emit_cpi!(PurchaseEvent {
            product: product.key(),
            purchase: purchase.key(),
            owner: purchase.owner,
            regarding: purchase.regarding,
            amount_paid: new_purchase_history.amount_paid,
            quantity: new_purchase_history.quantity,
            purchased_ts: new_purchase_history.purchased_ts,
            expires_ts: purchase.expires_ts,
            upgraded: total_already_paid > 0
        });

        purchase.add_history(new_purchase_history);

        Ok(())
    }
}
