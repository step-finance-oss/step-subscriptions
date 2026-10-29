use anchor_lang::error_code;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Invalid authority update")]
    InvalidAuthorityUpdate,
    #[msg("Invalid chars in name")]
    InvalidCharsInName,
    #[msg("Invalid chars in code")]
    InvalidCharsInCode,
    #[msg("Invalid product name length")]
    InvalidLengthName,
    #[msg("Invalid product blurb length")]
    InvalidLengthBlurb,
    #[msg("Invalid product family length")]
    InvalidLengthFamily,
    #[msg("Invalid product upgrade group length")]
    InvalidLengthUpgradeGroup,
    #[msg("Invalid product code length")]
    InvalidLengthCode,
    #[msg("Invalid role length")]
    InvalidLengthRole,
    #[msg("Invalid role count")]
    InvalidRoleCount,
    #[msg("Product not active")]
    InactiveProduct,
    #[msg("Max owned cannot be zero")]
    InvalidMaxOwned,
    #[msg("Invalid purchase duration")]
    InvalidPurchaseDuration,
    #[msg("Invalid purchase qty")]
    InvalidPurchaseQty,
    #[msg("Max purchase qty reached")]
    MaxPurchaseQtyReached,
    #[msg("Purchase Product Mismatch")]
    PurchaseProductMismatch,
    #[msg("Purchase regarding field mismatch")]
    PurchaseRegardingMismatch,
    #[msg("Purchase owner field mismatch")]
    PurchaseOwnerMismatch,
    #[msg("Purchases not distinct")]
    DistinctPurchases,
    #[msg("Invalid upgrade group")]
    InvalidUpgradeGroup,
    #[msg("Invalid percent through")]
    InvalidPercentThrough,
    #[msg("Downgrades not supported")]
    DowngradesNotSupported,
    #[msg("Invalid str20a5 count")]
    InvalidStr20A5Count,
    #[msg("Upgrade credits must use the same payment mint")]
    InvalidPaymentMint,
    #[msg("Payment mint cannot change after a purchase")]
    ProductMintLocked,
    #[msg("Legacy permanent purchase requires an explicit ownership migration")]
    PurchaseMigrationRequired,
    #[msg("Arithmetic overflow or inconsistent accounting")]
    ArithmeticOverflow,
    #[msg("Invalid discount basis points or quantity threshold")]
    InvalidDiscount,
    #[msg("Upgrade accounts must be writable purchase pairs")]
    InvalidUpgradeAccounts,
}
