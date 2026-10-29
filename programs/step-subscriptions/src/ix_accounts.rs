use super::errors::ErrorCode::*;
use super::state::*;
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Token, TokenAccount},
};

#[constant]
pub const GLOBAL_STATE_SEED: &str = "global_state";
#[constant]
pub const PRODUCT_SEED: &str = "product";
#[constant]
pub const PURCHASE_SEED: &str = "purchase";

#[derive(Accounts)]
pub struct InitializeProgram<'info> {
    // Bind bootstrap to this executable's actual upgrade authority.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @InvalidAuthority)]
    pub program: Program<'info, crate::program::StepSubscriptions>,

    #[account(constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key()) @InvalidAuthority)]
    pub program_data: Account<'info, ProgramData>,

    pub upgrade_authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + GlobalState::SIZE,
        seeds = [ GLOBAL_STATE_SEED.as_bytes() ],
        bump,
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ChangeGlobalState<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ GLOBAL_STATE_SEED.as_bytes() ],
        bump = global_state.bump,
        constraint = global_state.is_authorized(authority.key()) @InvalidAuthority
    )]
    pub global_state: Box<Account<'info, GlobalState>>,
}

#[derive(Accounts)]
#[instruction(code: String)]
pub struct CreateProduct<'info> {
    #[account(mut)]
    /// The payer of the new accounts' rents
    pub payer: Signer<'info>,

    pub authority: Signer<'info>,

    #[account(
        seeds = [ GLOBAL_STATE_SEED.as_bytes() ],
        bump = global_state.bump,
        constraint = global_state.is_authorized(authority.key()) @InvalidAuthority
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        init,
        payer = payer,
        space = 8 + Product::SIZE,
        seeds = [ PRODUCT_SEED.as_bytes(), code.trim().as_bytes() ],
        bump,
    )]
    pub product: Box<Account<'info, Product>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProduct<'info> {
    #[account(mut)]
    pub product: Box<Account<'info, Product>>,

    pub authority: Signer<'info>,

    #[account(
        seeds = [ GLOBAL_STATE_SEED.as_bytes() ],
        bump = global_state.bump,
        constraint = global_state.is_authorized(authority.key()) @InvalidAuthority
    )]
    pub global_state: Box<Account<'info, GlobalState>>,
}
#[event_cpi]
#[derive(Accounts)]
pub struct PurchaseProduct<'info> {
    #[account(mut)]
    /// The payer of the new accounts' rents
    pub payer: Signer<'info>,

    /// Owner of the purchase account
    pub owner: Signer<'info>,

    /// Account this purchase is regarding (usually owner)
    /// CHECK: this could be anything - we just use it for seed and reference
    pub regarding: UncheckedAccount<'info>,

    /// The one and only state account
    #[account(
        seeds = [ GLOBAL_STATE_SEED.as_bytes() ],
        bump = global_state.bump,
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(mut)]
    /// The token account to take payment from
    pub payment_from_token_account: Box<Account<'info, TokenAccount>>,
    /// The authority of the payment token account
    pub payment_from_token_authority: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = product.cost_mint,
        associated_token::authority = global_state.payment_wallet
    )]
    /// The token account to send payment to
    pub payment_to_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = product.active @InactiveProduct
    )]
    pub product: Box<Account<'info, Product>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Purchase::SIZE,
        seeds = [ PURCHASE_SEED.as_bytes(), owner.key.as_ref(), product.key().as_ref(), regarding.key.as_ref() ],
        bump,
    )]
    pub purchase: Box<Account<'info, Purchase>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DeletePurchase<'info> {
    #[account(mut)]
    /// The receiver of the closed purchase account's rents
    /// CHECK: the account to send the purchase account rent balance to
    pub refundee: UncheckedAccount<'info>,

    //an authority
    pub authority: Signer<'info>,

    #[account(
        seeds = [ GLOBAL_STATE_SEED.as_bytes() ],
        bump = global_state.bump,
        constraint = global_state.is_authorized(authority.key()) @InvalidAuthority
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(mut)]
    pub product: Box<Account<'info, Product>>,

    //no further checks on this account
    //if an admin wants to delete - an admin can delete
    #[account(
        mut,
        has_one = product,
        close = refundee,
    )]
    pub purchase: Box<Account<'info, Purchase>>,

    pub system_program: Program<'info, System>,
}
