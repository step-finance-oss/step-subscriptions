import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import * as token from "@solana/spl-token";
import assert from "node:assert/strict";
import { StepSubscriptions } from "../target/types/step_subscriptions";

anchor.setProvider(anchor.AnchorProvider.env());
const program = anchor.workspace
  .StepSubscriptions as Program<StepSubscriptions>;
const provider = program.provider as anchor.AnchorProvider;
const loader = new anchor.web3.PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
const programData = anchor.web3.PublicKey.findProgramAddressSync(
  [program.programId.toBuffer()],
  loader
)[0];
const buyer = anchor.web3.Keypair.generate();
let mint: anchor.web3.PublicKey;
let buyerTokens: anchor.web3.PublicKey;
let treasury: anchor.web3.PublicKey;
let sequence = 0;
const payer = (provider.wallet as anchor.Wallet).payer;

async function rejectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(
    promise,
    (error: any) => error.error?.errorCode?.code === code
  );
}
function initialize(
  payerKey: anchor.web3.PublicKey,
  upgradeAuthority: anchor.web3.PublicKey
) {
  const accounts = {
    payer: payerKey,
    upgradeAuthority,
    program: program.programId,
    programData,
  };
  return program.methods
    .initializeProgram(provider.wallet.publicKey, provider.wallet.publicKey)
    .accountsPartial(accounts);
}

describe("Bootstrap regression", () => {
  it("rejects a first initializer who is not the program upgrade authority", async () => {
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: buyer.publicKey,
          lamports: 1_000_000_000,
        })
      )
    );
    await rejectCode(
      initialize(buyer.publicKey, buyer.publicKey).signers([buyer]).rpc(),
      "InvalidAuthority"
    );
  });
});

describe("Bootstrap account substitution regressions", () => {
  it("rejects a different executable program even with the real ProgramData", async () => {
    await rejectCode(
      initialize(provider.wallet.publicKey, provider.wallet.publicKey)
        .accountsPartial({ program: token.TOKEN_PROGRAM_ID })
        .rpc(),
      "InvalidProgramId"
    );
  });
  it("rejects an unrelated account substituted for ProgramData", async () => {
    await rejectCode(
      initialize(provider.wallet.publicKey, provider.wallet.publicKey)
        .accountsPartial({ programData: buyer.publicKey })
        .rpc(),
      "AccountOwnedByWrongProgram"
    );
  });
  it("requires the upgrade authority's transaction signature", async () => {
    await assert.rejects(
      initialize(provider.wallet.publicKey, buyer.publicKey).rpc(),
      /signature/i
    );
  });
});

describe("Purchase regressions", () => {
  before(async () => {
    await initialize(
      provider.wallet.publicKey,
      provider.wallet.publicKey
    ).rpc();
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: buyer.publicKey,
          lamports: 2_000_000_000,
        })
      )
    );
    mint = await token.createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      0
    );
    buyerTokens = await token.createAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      buyer.publicKey
    );
    treasury = await token.createAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      payer.publicKey
    );
    await token.mintTo(
      provider.connection,
      payer,
      mint,
      buyerTokens,
      payer,
      1_000_000
    );
  });

  async function create(
    maxOwned = 12,
    group: string | null = null,
    paymentMint = mint,
    duration: anchor.BN | null = null
  ) {
    const code = `REG-${++sequence}`;
    const product = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("product"), Buffer.from(code)],
      program.programId
    )[0];
    await program.methods
      .createProduct(
        code,
        "Regression Product",
        "",
        "",
        group,
        paymentMint,
        new anchor.BN(1000),
        duration,
        maxOwned,
        []
      )
      .accountsPartial({
        payer: payer.publicKey,
        authority: payer.publicKey,
        product,
      })
      .rpc();
    await program.methods
      .updateProductActiveState(true)
      .accountsPartial({ authority: payer.publicKey, product })
      .rpc();
    const purchase = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("purchase"),
        buyer.publicKey.toBuffer(),
        product.toBuffer(),
        buyer.publicKey.toBuffer(),
      ],
      program.programId
    )[0];
    return { product, purchase };
  }
  function buy(product: anchor.web3.PublicKey, quantity: number) {
    return program.methods
      .purchaseProduct(quantity)
      .accountsPartial({
        payer: buyer.publicKey,
        owner: buyer.publicKey,
        regarding: buyer.publicKey,
        product,
        paymentFromTokenAccount: buyerTokens,
        paymentFromTokenAuthority: buyer.publicKey,
        paymentToTokenAccount: treasury,
      })
      .signers([buyer]);
  }
  it("rejects zero quantity without creating a perpetual receipt or charging tokens", async () => {
    const p = await create();
    const before = await token.getAccount(provider.connection, buyerTokens);
    await rejectCode(buy(p.product, 0).rpc(), "InvalidPurchaseQty");
    assert.equal(
      await program.account.purchase.fetchNullable(p.purchase),
      null
    );
    assert.equal(
      (await token.getAccount(provider.connection, buyerTokens)).amount,
      before.amount
    );
  });
  it("rejects zero quantity for timed products without creating a receipt", async () => {
    const p = await create(12, null, mint, new anchor.BN(60));
    await rejectCode(buy(p.product, 0).rpc(), "InvalidPurchaseQty");
    assert.equal(
      await program.account.purchase.fetchNullable(p.purchase),
      null
    );
  });
  it("rejects a fresh permanent quantity over the cap and another purchase at the cap", async () => {
    const p = await create(1);
    await rejectCode(buy(p.product, 2).rpc(), "MaxPurchaseQtyReached");
    await buy(p.product, 1).rpc();
    await rejectCode(buy(p.product, 1).rpc(), "MaxPurchaseQtyReached");
    assert.equal(
      (await program.account.purchase.fetch(p.purchase)).history10.length,
      1
    );
  });
  it("retains permanent ownership across ten-entry history rollover", async () => {
    const p = await create(12);
    for (let i = 0; i < 11; i++) await buy(p.product, 1).rpc();
    assert.equal(
      (await program.account.purchase.fetch(p.purchase)).history10.length,
      10
    );
    await rejectCode(buy(p.product, 2).rpc(), "MaxPurchaseQtyReached");
    await buy(p.product, 1).rpc();
    await rejectCode(buy(p.product, 1).rpc(), "MaxPurchaseQtyReached");
  });
  it("rejects upgrade credit denominated in another mint without consuming source history", async () => {
    const otherMint = await token.createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      0
    );
    const source = await create(12, "mixed-mint");
    const target = await create(12, "mixed-mint", otherMint);
    const otherBuyerTokens = await token.createAssociatedTokenAccount(
      provider.connection,
      payer,
      otherMint,
      buyer.publicKey
    );
    const otherTreasury = await token.createAssociatedTokenAccount(
      provider.connection,
      payer,
      otherMint,
      payer.publicKey
    );
    await buy(source.product, 1).rpc();
    await rejectCode(
      buy(target.product, 1)
        .accountsPartial({
          paymentFromTokenAccount: otherBuyerTokens,
          paymentToTokenAccount: otherTreasury,
        })
        .remainingAccounts([
          { pubkey: source.product, isWritable: false, isSigner: false },
          { pubkey: source.purchase, isWritable: true, isSigner: false },
        ])
        .rpc(),
      "InvalidPaymentMint"
    );
    assert.equal(
      await program.account.purchase.fetchNullable(target.purchase),
      null
    );
    assert.equal(
      (await program.account.purchase.fetch(source.purchase)).history10[0]
        .refunded,
      null
    );
  });
  it("allows mint changes before purchases and rejects them after the first purchase", async () => {
    const p = await create();
    const otherMint = await token.createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      0
    );
    await program.methods
      .updateProductMint(otherMint)
      .accountsPartial({ authority: payer.publicKey, product: p.product })
      .rpc();
    await program.methods
      .updateProductMint(mint)
      .accountsPartial({ authority: payer.publicKey, product: p.product })
      .rpc();
    await buy(p.product, 1).rpc();
    await rejectCode(
      program.methods
        .updateProductMint(otherMint)
        .accountsPartial({ authority: payer.publicKey, product: p.product })
        .rpc(),
      "ProductMintLocked"
    );
    await program.methods
      .updateProductMint(mint)
      .accountsPartial({ authority: payer.publicKey, product: p.product })
      .rpc();
  });
  it("keeps the mint locked after deletion rolls revenue and quantity counters back to zero", async () => {
    const p = await create();
    const otherMint = await token.createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      0
    );
    await buy(p.product, 1).rpc();
    await program.methods
      .deletePurchase(true)
      .accountsPartial({
        authority: payer.publicKey,
        product: p.product,
        purchase: p.purchase,
        refundee: payer.publicKey,
      })
      .rpc();
    const product = await program.account.product.fetch(p.product);
    assert.equal(product.purchaseQty.toNumber(), 0);
    await rejectCode(
      program.methods
        .updateProductMint(otherMint)
        .accountsPartial({ authority: payer.publicKey, product: p.product })
        .rpc(),
      "ProductMintLocked"
    );
  });
  it("does not reuse permanent credit on a second purchase of the same product", async () => {
    const source = await create(12, "repeat-perm");
    const target = await create(12, "repeat-perm");
    await buy(source.product, 1).rpc();
    const accounts = [
      { pubkey: source.product, isWritable: false, isSigner: false },
      { pubkey: source.purchase, isWritable: true, isSigner: false },
    ];
    await buy(target.product, 1).remainingAccounts(accounts).rpc();
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    await buy(target.product, 1).remainingAccounts(accounts).rpc();
    assert.equal(
      before -
        (await token.getAccount(provider.connection, buyerTokens)).amount,
      1000n
    );
  });

  it("does not reuse permanent credit on additional timed subscription periods", async () => {
    const source = await create(12, "repeat-timed");
    const target = await create(12, "repeat-timed", mint, new anchor.BN(60));
    await buy(source.product, 1).rpc();
    const accounts = [
      { pubkey: source.product, isWritable: false, isSigner: false },
      { pubkey: source.purchase, isWritable: true, isSigner: false },
    ];
    await buy(target.product, 1).remainingAccounts(accounts).rpc();
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    await buy(target.product, 1).remainingAccounts(accounts).rpc();
    assert.equal(
      before -
        (await token.getAccount(provider.connection, buyerTokens)).amount,
      1000n
    );
  });

  it("rejects incomplete upgrade account pairs without creating a receipt", async () => {
    const target = await create(12, "odd-accounts");
    await rejectCode(
      buy(target.product, 1)
        .remainingAccounts([
          { pubkey: target.product, isWritable: false, isSigner: false },
        ])
        .rpc(),
      "InvalidUpgradeAccounts"
    );
    assert.equal(
      await program.account.purchase.fetchNullable(target.purchase),
      null
    );
  });

  it("returns an account validation error for malformed upgrade product accounts", async () => {
    const source = await create(12, "bad-accounts");
    const target = await create(12, "bad-accounts");
    await buy(source.product, 1).rpc();
    await rejectCode(
      buy(target.product, 1)
        .remainingAccounts([
          { pubkey: buyerTokens, isWritable: false, isSigner: false },
          { pubkey: source.purchase, isWritable: true, isSigner: false },
        ])
        .rpc(),
      "AccountOwnedByWrongProgram"
    );
  });

  it("rejects readonly upgrade purchase accounts without changing source credit", async () => {
    const source = await create(12, "readonly-credit");
    const target = await create(12, "readonly-credit");
    await buy(source.product, 1).rpc();
    await rejectCode(
      buy(target.product, 1)
        .remainingAccounts([
          { pubkey: source.product, isWritable: false, isSigner: false },
          { pubkey: source.purchase, isWritable: false, isSigner: false },
        ])
        .rpc(),
      "InvalidUpgradeAccounts"
    );
    assert.equal(
      (await program.account.purchase.fetch(source.purchase)).history10[0]
        .refunded,
      null
    );
  });

  it("rejects discounts above 100 percent and zero discount thresholds", async () => {
    const target = await create();
    for (const [bps, quantity] of [
      [10001, 1],
      [1000, 0],
    ]) {
      await rejectCode(
        program.methods
          .updateProductDiscount(new anchor.BN(bps), quantity)
          .accountsPartial({
            authority: payer.publicKey,
            product: target.product,
          })
          .rpc(),
        "InvalidDiscount"
      );
    }
  });

  it("calculates a large valid discount without overflowing its intermediate product", async () => {
    const target = await create();
    await program.methods
      .updateProductCost(new anchor.BN("9007199254740995"))
      .accountsPartial({ authority: payer.publicKey, product: target.product })
      .rpc();
    await program.methods
      .updateProductDiscount(new anchor.BN(5000), 1)
      .accountsPartial({ authority: payer.publicKey, product: target.product })
      .rpc();
    await token.mintTo(
      provider.connection,
      payer,
      mint,
      buyerTokens,
      payer,
      9007199254740995n
    );
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    await buy(target.product, 1).rpc();
    assert.equal(
      before -
        (await token.getAccount(provider.connection, buyerTokens)).amount,
      4503599627370498n
    );
  });

  it("reports price overflow without charging tokens or recording a purchase", async () => {
    const target = await create();
    await program.methods
      .updateProductCost(new anchor.BN("18446744073709551615"))
      .accountsPartial({ authority: payer.publicKey, product: target.product })
      .rpc();
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    await rejectCode(buy(target.product, 2).rpc(), "ArithmeticOverflow");
    assert.equal(
      (await token.getAccount(provider.connection, buyerTokens)).amount,
      before
    );
    assert.equal(
      await program.account.purchase.fetchNullable(target.purchase),
      null
    );
  });

  it("rejects invalid product quantities and durations at creation", async () => {
    await rejectCode(create(0), "InvalidMaxOwned");
    for (const duration of [
      new anchor.BN(0),
      new anchor.BN(-1),
      new anchor.BN("9223372036854775807"),
    ]) {
      await rejectCode(
        create(12, null, mint, duration),
        "InvalidPurchaseDuration"
      );
    }
  });

  it("reports timestamp overflow without charging tokens or recording a purchase", async () => {
    const target = await create(
      1,
      null,
      mint,
      new anchor.BN("9223372036854775807")
    );
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    await rejectCode(buy(target.product, 1).rpc(), "ArithmeticOverflow");
    assert.equal(
      (await token.getAccount(provider.connection, buyerTokens)).amount,
      before
    );
    assert.equal(
      await program.account.purchase.fetchNullable(target.purchase),
      null
    );
  });

  it("grants only new cash in a larger cumulative permanent credit pool", async () => {
    const first = await create(12, "cumulative-pool");
    const second = await create(12, "cumulative-pool");
    const target = await create(12, "cumulative-pool");
    await buy(first.product, 1).rpc();
    const firstPair = [
      { pubkey: first.product, isWritable: false, isSigner: false },
      { pubkey: first.purchase, isWritable: true, isSigner: false },
    ];
    await buy(target.product, 1).remainingAccounts(firstPair).rpc();
    await buy(second.product, 1).rpc();
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    const cumulative = [
      ...firstPair,
      { pubkey: second.product, isWritable: false, isSigner: false },
      { pubkey: second.purchase, isWritable: true, isSigner: false },
    ];
    await buy(target.product, 1).remainingAccounts(cumulative).rpc();
    assert.equal(
      (await token.getAccount(provider.connection, buyerTokens)).amount,
      before
    );
    await buy(target.product, 1).remainingAccounts(cumulative).rpc();
    assert.equal(
      before -
        (await token.getAccount(provider.connection, buyerTokens)).amount,
      1000n
    );
  });

  it("rolls target credit back when a purchase is rejected as a downgrade", async () => {
    const source = await create(12, "credit-rollback");
    const target = await create(12, "credit-rollback");
    await buy(source.product, 1).rpc();
    await program.methods
      .updateProductCost(new anchor.BN(500))
      .accountsPartial({ authority: payer.publicKey, product: target.product })
      .rpc();
    const accounts = [
      { pubkey: source.product, isWritable: false, isSigner: false },
      { pubkey: source.purchase, isWritable: true, isSigner: false },
    ];
    await rejectCode(
      buy(target.product, 1).remainingAccounts(accounts).rpc(),
      "DowngradesNotSupported"
    );
    assert.equal(
      (await program.account.purchase.fetch(source.purchase)).history10[0]
        .refunded,
      null
    );
    await program.methods
      .updateProductCost(new anchor.BN(2000))
      .accountsPartial({ authority: payer.publicKey, product: target.product })
      .rpc();
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    await buy(target.product, 1).remainingAccounts(accounts).rpc();
    assert.equal(
      before -
        (await token.getAccount(provider.connection, buyerTokens)).amount,
      1000n
    );
  });
  it("credits new permanent cash after the ten-receipt history rolls over", async () => {
    const source = await create(12, "rollover-credit");
    const target = await create(12, "rollover-credit");
    await program.methods
      .updateProductCost(new anchor.BN(10000))
      .accountsPartial({ authority: payer.publicKey, product: target.product })
      .rpc();
    for (let i = 0; i < 10; i++) await buy(source.product, 1).rpc();
    const accounts = [
      { pubkey: source.product, isWritable: false, isSigner: false },
      { pubkey: source.purchase, isWritable: true, isSigner: false },
    ];
    await buy(target.product, 1).remainingAccounts(accounts).rpc();
    await buy(source.product, 1).rpc();
    const before = (await token.getAccount(provider.connection, buyerTokens))
      .amount;
    await buy(target.product, 1).remainingAccounts(accounts).rpc();
    assert.equal(
      before -
        (await token.getAccount(provider.connection, buyerTokens)).amount,
      9000n
    );
  });

  it("removes lifetime accounting when an admin deletes a rolled-over purchase", async () => {
    const target = await create(12);
    for (let i = 0; i < 11; i++) await buy(target.product, 1).rpc();
    await program.methods
      .deletePurchase(true)
      .accountsPartial({
        authority: payer.publicKey,
        product: target.product,
        purchase: target.purchase,
        refundee: payer.publicKey,
      })
      .rpc();
    const product = await program.account.product.fetch(target.product);
    assert.equal(product.purchaseRevenue.toString(), "0");
    assert.equal(product.purchaseQty.toString(), "0");
  });
});
