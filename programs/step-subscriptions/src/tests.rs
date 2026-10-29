use crate::state::*;
use anchor_lang::prelude::*;

fn product() -> Product {
    Product {
        bump: 0,
        active: true,
        code_16: "SKU100".into(),
        name_32: "Example Product".into(),
        blurb_128: String::new(),
        family_32: String::new(),
        upgrade_group_32: None,
        created_ts: 0,
        cost_mint: Pubkey::new_unique(),
        cost: 1_000_000,
        discount_bps: 0,
        qty_for_discount: 12,
        purchase_duration_secs: Some(60),
        max_owned: 12,
        total_paid: 0,
        assigned_roles_6_a10: vec![],
        i64_a5: [0; 5],
        str_20_a5: vec![],
        purchase_qty: 0,
        purchase_revenue: 0,
        reserved: [0; 240],
    }
}

fn purchase() -> Purchase {
    Purchase {
        bump: 0,
        owner: Pubkey::new_unique(),
        product: Pubkey::new_unique(),
        regarding: Pubkey::new_unique(),
        expires_ts: i64::MAX,
        history_10: vec![],
        reserved: [0; 64],
    }
}

#[test]
fn authorization_accepts_either_admin_and_rejects_an_outsider() {
    let first = Pubkey::new_unique();
    let second = Pubkey::new_unique();
    let state = GlobalState {
        bump: 0,
        payment_wallet: Pubkey::new_unique(),
        authorities: [first, second],
        reserved: [0; 64],
    };
    assert!(state.is_authorized(first));
    assert!(state.is_authorized(second));
    assert!(!state.is_authorized(Pubkey::new_unique()));
}

#[test]
fn product_validation_normalizes_outer_whitespace() {
    let mut p = product();
    p.code_16 = " SKU-100 ".into();
    p.name_32 = " Example Product ".into();
    p.blurb_128 = " Details ".into();
    p.family_32 = " Group ".into();
    p.validate().unwrap();
    assert_eq!(p.code_16, "SKU-100");
    assert_eq!(p.name_32, "Example Product");
    assert_eq!(p.blurb_128, "Details");
    assert_eq!(p.family_32, "Group");
}

#[test]
fn product_codes_reject_invalid_lengths_and_characters() {
    for code in ["AB", "ABCDEFGHIJKLMNOPQ", "BAD_CODE", "A B", "ééé"] {
        let mut p = product();
        p.code_16 = code.into();
        assert!(p.validate().is_err(), "accepted invalid code: {code}");
    }
    for code in ["ABC", "ABCDEFGHIJKLMNOP", "SKU-100"] {
        let mut p = product();
        p.code_16 = code.into();
        p.validate().unwrap();
    }
}

#[test]
fn product_names_reject_invalid_lengths_and_characters() {
    for name in ["ABC", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567", "Not_OK", "Café"] {
        let mut p = product();
        p.name_32 = name.into();
        assert!(p.validate().is_err(), "accepted invalid name: {name}");
    }
    for name in ["ABCD", "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"] {
        let mut p = product();
        p.name_32 = name.into();
        p.validate().unwrap();
    }
}

#[test]
fn product_text_fields_enforce_byte_limits() {
    let mut p = product();
    p.blurb_128 = "b".repeat(128);
    p.family_32 = "f".repeat(32);
    p.upgrade_group_32 = Some("u".repeat(32));
    p.validate().unwrap();
    p.blurb_128.push('b');
    assert!(p.validate().is_err());
    let mut p = product();
    p.family_32 = "f".repeat(33);
    assert!(p.validate().is_err());
    let mut p = product();
    p.upgrade_group_32 = Some("u".repeat(33));
    assert!(p.validate().is_err());
    let mut p = product();
    p.blurb_128 = "é".repeat(65);
    assert!(p.validate().is_err());
}

#[test]
fn roles_enforce_count_and_individual_length() {
    let mut p = product();
    p.assigned_roles_6_a10 = vec!["ABCDEFGHIJ".into(); 10];
    p.validate().unwrap();
    p.assigned_roles_6_a10.push("ABC".into());
    assert!(p.validate().is_err());
    for role in ["AB", "ABCDEFGHIJK"] {
        let mut p = product();
        p.assigned_roles_6_a10 = vec![role.into()];
        assert!(p.validate().is_err());
    }
}

#[test]
fn custom_strings_enforce_count_and_byte_length() {
    let mut p = product();
    p.str_20_a5 = vec!["s".repeat(20); 5];
    p.validate().unwrap();
    p.str_20_a5.push(String::new());
    assert!(p.validate().is_err());
    let mut p = product();
    p.str_20_a5 = vec!["s".repeat(21)];
    assert!(p.validate().is_err());
}

#[test]
fn purchase_history_retains_the_latest_ten_receipts_in_order() {
    let mut p = purchase();
    for i in 0..13 {
        p.add_history(PurchaseHistory {
            amount_paid: i as u64 * 100,
            quantity: 1,
            purchased_ts: i,
            refunded: Some(i as u64),
        });
    }
    assert_eq!(p.history_10.len(), 10);
    assert_eq!(p.history_10[0].purchased_ts, 3);
    assert_eq!(p.history_10[9].purchased_ts, 12);
    assert_eq!(p.history_10[0].amount_paid, 300);
    assert_eq!(p.history_10[9].refunded, Some(12));
}

#[test]
fn maximum_product_encoding_fits_the_allocated_account() {
    let mut p = product();
    p.code_16 = "C".repeat(16);
    p.name_32 = "N".repeat(32);
    p.blurb_128 = "B".repeat(128);
    p.family_32 = "F".repeat(32);
    p.upgrade_group_32 = Some("U".repeat(32));
    p.assigned_roles_6_a10 = vec!["R".repeat(10); 10];
    p.str_20_a5 = vec!["S".repeat(20); 5];
    p.validate().unwrap();
    let mut bytes = Vec::new();
    p.try_serialize(&mut bytes).unwrap();
    assert!(bytes.len() <= 8 + Product::SIZE);
}

#[test]
fn maximum_purchase_encoding_fits_the_allocated_account() {
    let mut p = purchase();
    for _ in 0..10 {
        p.add_history(PurchaseHistory {
            amount_paid: u64::MAX,
            quantity: u8::MAX,
            purchased_ts: i64::MAX,
            refunded: Some(u64::MAX),
        });
    }
    let mut bytes = Vec::new();
    p.try_serialize(&mut bytes).unwrap();
    assert_eq!(bytes.len(), 8 + Purchase::SIZE);
}

#[test]
fn empty_history_has_no_active_units() {
    let p = purchase();
    assert_eq!(p.total_active_at(None, 100), 0);
    assert_eq!(p.total_active_at(Some(60), 100), 0);
}

#[test]
fn permanent_active_quantity_sums_multiple_receipts() {
    let mut p = purchase();
    for quantity in [2, 3, 1] {
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity,
            purchased_ts: 0,
            refunded: None,
        });
    }
    assert_eq!(p.total_active_at(None, 100), 6);
}

#[test]
fn timed_active_quantity_stops_at_expired_periods() {
    let mut p = purchase();
    p.expires_ts = 280;
    p.add_history(PurchaseHistory {
        amount_paid: 300,
        quantity: 3,
        purchased_ts: 100,
        refunded: None,
    });
    for (now, expected) in [(100, 3), (160, 2), (220, 1), (280, 0), (281, 0)] {
        assert_eq!(p.total_active_at(Some(60), now), expected, "clock={now}");
    }
}

#[test]
fn timed_active_quantity_walks_across_receipt_boundaries() {
    let mut p = purchase();
    p.expires_ts = 400;
    for quantity in [2, 3] {
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity,
            purchased_ts: 0,
            refunded: None,
        });
    }
    assert_eq!(p.total_active_at(Some(60), 100), 5);
    assert_eq!(p.total_active_at(Some(60), 220), 3);
}

#[test]
fn permanent_counter_rejects_zero_and_preserves_state_on_rejection() {
    let mut p = purchase();
    assert!(p.add_permanent_quantity(0, 12).is_err());
    assert_eq!(p.reserved, [0; 64]);
    p.add_permanent_quantity(1, 1).unwrap();
    let before = p.reserved;
    assert!(p.add_permanent_quantity(1, 1).is_err());
    assert_eq!(p.reserved, before);
}

#[test]
fn permanent_counter_accepts_exact_u8_limit_without_wrapping() {
    let mut p = purchase();
    p.add_permanent_quantity(254, 255).unwrap();
    p.add_permanent_quantity(1, 255).unwrap();
    assert!(p.add_permanent_quantity(1, 255).is_err());
}

#[test]
fn permanent_counter_survives_history_rollover() {
    let mut p = purchase();
    for i in 0..12 {
        p.add_permanent_quantity(1, 12).unwrap();
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity: 1,
            purchased_ts: i,
            refunded: None,
        });
    }
    assert_eq!(p.history_10.len(), 10);
    assert!(p.add_permanent_quantity(1, 12).is_err());
}

#[test]
fn short_legacy_permanent_history_seeds_exact_quantity() {
    let mut p = purchase();
    p.add_history(PurchaseHistory {
        amount_paid: 100,
        quantity: 3,
        purchased_ts: 0,
        refunded: None,
    });
    p.add_permanent_quantity(2, 5).unwrap();
    assert!(p.add_permanent_quantity(1, 5).is_err());
}

#[test]
fn legacy_history_at_capacity_requires_migration_instead_of_guessing() {
    let mut p = purchase();
    for _ in 0..10 {
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity: 1,
            purchased_ts: 0,
            refunded: None,
        });
    }
    assert!(p.add_permanent_quantity(1, 255).is_err());
    assert_eq!(p.reserved, [0; 64]);
}

#[test]
fn legacy_quantities_and_delete_totals_are_wider_than_u8() {
    let mut p = purchase();
    for _ in 0..2 {
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity: 255,
            purchased_ts: 0,
            refunded: None,
        });
    }
    assert_eq!(p.total_active_at(None, 100), 510);
    assert_eq!(p.history_totals().unwrap(), (200, 510));
    assert!(p.add_permanent_quantity(1, 255).is_err());
}

#[test]
fn history_revenue_overflow_is_reported_instead_of_wrapping_or_panicking() {
    let mut p = purchase();
    for amount_paid in [u64::MAX, 1] {
        p.add_history(PurchaseHistory {
            amount_paid,
            quantity: 1,
            purchased_ts: 0,
            refunded: None,
        });
    }
    assert!(p.history_totals().is_err());
}

#[test]
fn unknown_counter_versions_fail_closed() {
    let mut p = purchase();
    p.reserved[0] = 2;
    assert!(p.add_permanent_quantity(1, 255).is_err());
}

#[test]
fn product_mint_lock_survives_counter_reset() {
    let mut p = product();
    assert!(p.can_change_mint());
    p.mark_purchased();
    p.purchase_qty = 0;
    p.purchase_revenue = 0;
    assert!(!p.can_change_mint());
}

#[test]
fn legacy_purchase_counters_also_lock_the_mint() {
    let mut p = product();
    p.purchase_qty = 1;
    assert!(!p.can_change_mint());
    p.purchase_qty = 0;
    p.purchase_revenue = 100;
    assert!(!p.can_change_mint());
}

#[test]
fn product_rejects_zero_max_owned() {
    let mut p = product();
    p.max_owned = 0;
    assert!(p.validate().is_err());
}

#[test]
fn product_rejects_nonpositive_or_overflowing_durations() {
    for duration in [0, -1, i64::MAX] {
        let mut p = product();
        p.purchase_duration_secs = Some(duration);
        assert!(p.validate().is_err(), "accepted duration {duration}");
    }
}

#[test]
fn product_rejects_invalid_discount_configuration() {
    let mut p = product();
    p.discount_bps = 10_001;
    assert!(p.validate().is_err());
    let mut p = product();
    p.qty_for_discount = 0;
    assert!(p.validate().is_err());
}

#[test]
fn exact_proration_never_rounds_large_payments_up_or_creates_credit() {
    assert_eq!(
        crate::upgrade::prorated_credit(u64::MAX, 1, 2).unwrap(),
        9_223_372_036_854_775_807
    );
    assert_eq!(
        crate::upgrade::prorated_credit(9_007_199_254_740_995, 1, 9_223_372_035_054_775_807)
            .unwrap(),
        9_007_199_254_740_994
    );
}

#[test]
fn proration_rejects_negative_elapsed_time() {
    assert!(crate::upgrade::prorated_credit(100, -1, 60).is_err());
}

#[test]
fn partially_elapsed_subscription_unit_is_still_active() {
    let mut p = purchase();
    p.expires_ts = 280;
    p.add_history(PurchaseHistory {
        amount_paid: 300,
        quantity: 3,
        purchased_ts: 100,
        refunded: None,
    });
    assert_eq!(p.total_active_at(Some(60), 101), 3);
    assert_eq!(p.total_active_at(Some(60), 279), 1);
}

#[test]
fn permanent_credit_pool_is_incremental_and_never_resets() {
    let mut p = purchase();
    p.add_permanent_quantity(1, 12).unwrap();
    assert_eq!(p.permanent_upgrade_credit(100).unwrap(), 100);
    p.add_history(PurchaseHistory {
        amount_paid: 0,
        quantity: 1,
        purchased_ts: 0,
        refunded: None,
    });
    assert_eq!(p.permanent_upgrade_credit(100).unwrap(), 0);
    assert_eq!(p.permanent_upgrade_credit(50).unwrap(), 0);
    assert_eq!(p.permanent_upgrade_credit(175).unwrap(), 75);
    assert_eq!(p.permanent_upgrade_credit(175).unwrap(), 0);
    assert_eq!(u64::from_le_bytes(p.reserved[1..9].try_into().unwrap()), 1);
}

#[test]
fn legacy_targets_allow_cash_but_require_migration_before_permanent_credit() {
    let mut p = purchase();
    p.add_history(PurchaseHistory {
        amount_paid: 100,
        quantity: 1,
        purchased_ts: 0,
        refunded: None,
    });
    assert_eq!(p.permanent_upgrade_credit(0).unwrap(), 0);
    assert_eq!(p.reserved[9], 0);
    assert!(p.permanent_upgrade_credit(100).is_err());
    p.reserved[9] = 2;
    assert!(p.permanent_upgrade_credit(0).is_err());
}

#[test]
fn discounts_apply_to_net_credit_and_round_the_discount_down() {
    let mut p = product();
    p.cost = 1001;
    p.discount_bps = 1250;
    p.qty_for_discount = 2;
    assert_eq!(p.payment_amount(1, 0).unwrap(), 1001);
    assert_eq!(p.payment_amount(2, 2).unwrap(), 1750);
    assert_eq!(p.payment_amount(2, 1).unwrap(), 1751);
    p.discount_bps = 10_000;
    assert_eq!(p.payment_amount(2, 0).unwrap(), 0);
    assert!(p.payment_amount(2, 2003).is_err());
    assert!(p.payment_amount(0, 0).is_err());
}

#[test]
fn expiry_extensions_enforce_remaining_duration_and_timestamp_bounds() {
    let mut p = product();
    assert_eq!(p.purchase_expiry(0, 1, 100).unwrap(), 160);
    assert_eq!(p.purchase_expiry(160, 2, 100).unwrap(), 280);
    assert_eq!(p.purchase_expiry(90, 1, 100).unwrap(), 160);
    assert!(p.purchase_expiry(820, 1, 100).is_err());
    assert!(p.purchase_expiry(0, 1, i64::MAX - 30).is_err());
    p.purchase_duration_secs = None;
    assert_eq!(p.purchase_expiry(0, 1, 100).unwrap(), i64::MAX);
}

#[test]
fn failed_sale_accounting_does_not_partially_update_counters() {
    let mut p = product();
    p.purchase_revenue = u64::MAX;
    assert!(p.record_sale(1, 1).is_err());
    assert_eq!(p.purchase_qty, 0);
    p.purchase_revenue = 0;
    p.purchase_qty = u64::MAX;
    assert!(p.record_sale(1, 1).is_err());
    assert_eq!(p.purchase_revenue, 0);
    assert_eq!(p.reserved[0], 0);
}

#[test]
fn integer_proration_handles_unused_and_expired_periods() {
    assert_eq!(crate::upgrade::prorated_credit(101, 0, 60).unwrap(), 101);
    assert_eq!(crate::upgrade::prorated_credit(101, 30, 60).unwrap(), 50);
    assert_eq!(crate::upgrade::prorated_credit(101, 60, 60).unwrap(), 0);
    assert!(crate::upgrade::prorated_credit(101, 61, 60).is_err());
    assert!(crate::upgrade::prorated_credit(101, 0, 0).is_err());
}

#[test]
fn active_permanent_quantity_uses_the_durable_total_after_history_rollover() {
    let mut p = purchase();
    for _ in 0..12 {
        p.add_permanent_quantity(1, 12).unwrap();
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity: 1,
            purchased_ts: 0,
            refunded: None,
        });
    }
    assert_eq!(p.total_active_at(None, 100), 12);
}

#[test]
fn lifetime_payment_totals_survive_receipt_rollover() {
    let mut p = purchase();
    for _ in 0..12 {
        p.record_payment(100, 1).unwrap();
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity: 1,
            purchased_ts: 0,
            refunded: None,
        });
    }
    assert_eq!(p.history_10.len(), 10);
    assert_eq!(p.payment_totals().unwrap(), (1200, 12));
    assert_eq!(p.history_totals().unwrap(), (1000, 10));
}

#[test]
fn lifetime_payment_totals_seed_short_legacy_history_exactly() {
    let mut p = purchase();
    p.add_history(PurchaseHistory {
        amount_paid: 100,
        quantity: 2,
        purchased_ts: 0,
        refunded: None,
    });
    assert_eq!(p.payment_totals().unwrap(), (100, 2));
    p.record_payment(50, 1).unwrap();
    assert_eq!(p.payment_totals().unwrap(), (150, 3));
}

#[test]
fn ambiguous_legacy_cash_renewals_do_not_fabricate_lifetime_totals() {
    let mut p = purchase();
    for _ in 0..10 {
        p.add_history(PurchaseHistory {
            amount_paid: 100,
            quantity: 1,
            purchased_ts: 0,
            refunded: None,
        });
    }
    p.record_payment(50, 1).unwrap();
    assert_eq!(p.reserved[18], 0);
    assert!(p.payment_totals().is_err());
    p.reserved[18] = 2;
    assert!(p.record_payment(50, 1).is_err());
}

#[test]
fn payment_overflow_does_not_advance_lifetime_quantity() {
    let mut p = purchase();
    p.record_payment(u64::MAX, 1).unwrap();
    assert!(p.record_payment(1, 1).is_err());
    assert_eq!(p.payment_totals().unwrap(), (u64::MAX, 1));
}
