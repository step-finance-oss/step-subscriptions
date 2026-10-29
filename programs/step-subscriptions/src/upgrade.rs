use crate::errors::ErrorCode;
use crate::ix_accounts::*;
use crate::state;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::{self};
use std::collections::HashSet;

pub fn check_purchase_upgrade(ctx: &Context<PurchaseProduct>) -> Result<u64> {
    let product_to_purchase = &ctx.accounts.product;

    if product_to_purchase.upgrade_group_32.is_none() {
        return Ok(0);
    }

    let prev_accounts = ctx.remaining_accounts.chunks_exact(2); // [product, purchase, ...]
    let mut total_already_paid = 0;
    let mut purchase_hashset = HashSet::new();
    for c in prev_accounts {
        let product_key = c[0].key;
        let purchase_key = c[1].key;

        let product = Account::<state::Product>::try_from(&c[0]).unwrap();
        let mut purchase = Account::<state::Purchase>::try_from(&c[1]).unwrap();

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

        // check that all purchases are distinct
        if !purchase_hashset.insert(purchase_key) {
            return err!(ErrorCode::DistinctPurchases);
        }

        let current_time = sysvar::clock::Clock::get().unwrap().unix_timestamp;
        let mut expires_ts = purchase.expires_ts;

        if expires_ts < current_time {
            continue; // already expired
        }

        for history in purchase.history_10.iter_mut().rev() {
            // check for prorate if there is an expiration
            if let Some(purchase_duration_secs) = product.purchase_duration_secs {
                if history.refunded.is_some() {
                    break;
                }
                let start_date = expires_ts - (history.quantity as i64 * purchase_duration_secs);
                // prorate
                if start_date < current_time {
                    let percent_through = (current_time - start_date) as f64
                        / (purchase_duration_secs * history.quantity as i64) as f64;
                    require_gte!(1.0, percent_through, ErrorCode::InvalidPercentThrough);
                    let remaining_unused_pct = 1.0 - percent_through;
                    let amount_refunded =
                        (history.amount_paid as f64 * remaining_unused_pct) as u64;
                    total_already_paid += amount_refunded;
                    history.refunded = Some(amount_refunded);
                    break;
                }
                expires_ts = start_date;
            }
            total_already_paid += history.amount_paid;
            history.refunded = Some(history.amount_paid);
        }

        purchase.exit(ctx.program_id)?;
    }

    Ok(total_already_paid)
}
