use crate::errors::ErrorCode;
use crate::ix_accounts::*;
use crate::state;
use anchor_lang::prelude::*;
use std::collections::HashSet;

pub fn check_purchase_upgrade(ctx: &Context<PurchaseProduct>) -> Result<(u64, u64)> {
    let product_to_purchase = &ctx.accounts.product;

    require_eq!(
        ctx.remaining_accounts.len() % 2,
        0,
        ErrorCode::InvalidUpgradeAccounts
    );
    if product_to_purchase.upgrade_group_32.is_none() {
        require!(
            ctx.remaining_accounts.is_empty(),
            ErrorCode::InvalidUpgradeAccounts
        );
        return Ok((0, 0));
    }

    let prev_accounts = ctx.remaining_accounts.chunks_exact(2); // [product, purchase, ...]
    let mut permanent_pool = 0_u64;
    let mut timed_credit = 0_u64;
    let current_time = Clock::get()?.unix_timestamp;
    let mut purchase_hashset = HashSet::new();
    for c in prev_accounts {
        let product_key = c[0].key;
        let purchase_key = c[1].key;

        require!(c[1].is_writable, ErrorCode::InvalidUpgradeAccounts);
        let product = Account::<state::Product>::try_from(&c[0])?;
        let mut purchase = Account::<state::Purchase>::try_from(&c[1])?;
        product.validate_economics()?;

        // check purchase is not itself
        require_keys_neq!(
            ctx.accounts.purchase.key(),
            *purchase_key,
            ErrorCode::DistinctPurchases
        );

        // check product and purchase match each other
        require_eq!(
            product_key.to_string(),
            purchase.product.to_string(),
            ErrorCode::PurchaseProductMismatch
        );

        // check purchase owner match each other
        require_eq!(
            ctx.accounts.owner.key(),
            purchase.owner,
            ErrorCode::PurchaseOwnerMismatch
        );

        // check regarding match each other
        require_eq!(
            ctx.accounts.regarding.key(),
            purchase.regarding,
            ErrorCode::PurchaseRegardingMismatch
        );

        // check upgrade group matches product being purchased
        if product.upgrade_group_32 != product_to_purchase.upgrade_group_32 {
            return err!(ErrorCode::InvalidUpgradeGroup);
        }

        // A history amount is denominated in its original, now-immutable mint.
        require_keys_eq!(
            product.cost_mint,
            product_to_purchase.cost_mint,
            ErrorCode::InvalidPaymentMint
        );

        // check that all purchases are distinct
        if !purchase_hashset.insert(purchase_key) {
            return err!(ErrorCode::DistinctPurchases);
        }

        let mut expires_ts = purchase.expires_ts;

        if expires_ts <= current_time {
            continue; // already expired
        }

        if product.purchase_duration_secs.is_none() {
            permanent_pool = permanent_pool
                .checked_add(purchase.payment_totals()?.0)
                .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
        }

        for history in purchase.history_10.iter_mut().rev() {
            // check for prorate if there is an expiration
            if let Some(purchase_duration_secs) = product.purchase_duration_secs {
                if history.refunded.is_some() {
                    break;
                }
                if history.quantity == 0 && history.amount_paid == 0 {
                    continue;
                }
                require_gt!(history.quantity, 0, ErrorCode::InvalidPurchaseQty);
                let period = purchase_duration_secs
                    .checked_mul(i64::from(history.quantity))
                    .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
                let start_date = expires_ts
                    .checked_sub(period)
                    .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
                if start_date < current_time {
                    let elapsed = current_time
                        .checked_sub(start_date)
                        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
                    let amount_refunded = prorated_credit(history.amount_paid, elapsed, period)?;
                    timed_credit = timed_credit
                        .checked_add(amount_refunded)
                        .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
                    history.refunded = Some(amount_refunded);
                    break;
                }
                expires_ts = start_date;
                timed_credit = timed_credit
                    .checked_add(history.amount_paid)
                    .ok_or(error!(ErrorCode::ArithmeticOverflow))?;
            }
            history.refunded = Some(history.amount_paid);
        }

        purchase.exit(ctx.program_id)?;
    }

    Ok((permanent_pool, timed_credit))
}

pub(crate) fn prorated_credit(amount_paid: u64, elapsed: i64, duration: i64) -> Result<u64> {
    require!(
        duration > 0 && elapsed >= 0 && elapsed <= duration,
        ErrorCode::InvalidPercentThrough
    );
    let remaining = (duration - elapsed) as u128;
    Ok((u128::from(amount_paid) * remaining / duration as u128) as u64)
}
