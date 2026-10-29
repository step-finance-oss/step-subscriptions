// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@anchor-lang/core";
import { StepSubscriptions } from "../target/types/step_subscriptions";

const I64_MAX = new anchor.BN("9223372036854775807");

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  const program = anchor.workspace
    .StepSubscriptions as anchor.Program<StepSubscriptions>;

  const gss = await program.account.globalState.all();
  console.log(`There are ${gss.length} global state accounts`);
  const gs = gss[0];
  console.log(
    `Global state: auths: ${gs.account.authorities.map((a) =>
      a.toString()
    )}, payment:${gs.account.paymentWallet.toString()}`
  );

  // const productAccounts = await program.account.product.all();
  // console.log(`There are ${productAccounts.length} products:`);
  // productAccounts.sort((a, b) => a.account.i64A5[0].cmp(b.account.i64A5[0]));
  // productAccounts.sort((a, b) => a.account.i64A5[1].cmp(b.account.i64A5[1]));
  // console.log(productAccounts.map((pa) => `${pa.account.blurb128} includes ${pa.account.i64A5[0]} txs for year ${pa.account.i64A5[1]} at a cost of ${pa.account.cost.toNumber() / 1000000}`).join("\n"));

  // const purchases = await program.account.purchase.all();
  // console.log(`There are ${purchases.length} purchases:`);
  // const j = purchases.map(a => ({
  //   purchase: a,
  //   product: productAccounts.find(p => p.publicKey.equals(a.account.product))
  // }));
  // j.sort((a, b) => a.product.account.i64A5[0].cmp(b.product.account.i64A5[0]));
  // j.sort((a, b) => a.product.account.i64A5[1].cmp(b.product.account.i64A5[1]));

  // console.log(`Buyer,Tier,Year,Cost`);
  // for (const pp of j) {
  //   //print csv all fields
  //   console.log(`${pp.purchase.account.owner.toBase58()},${pp.product.account.name32},${pp.product.account.i64A5[1]},${pp.product.account.cost.toNumber() / 1000000}`);
  // }

  const authority = program.provider.publicKey;
  const stepFeeWallet = new anchor.web3.PublicKey(
    "5Cebzty8iwgAUx9jyfZVAT2iMvXBECLwEVgT6T8KYmvS"
  );
  const usdcMintMainnet = new anchor.web3.PublicKey(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  );
  const usdcMintDevnet = new anchor.web3.PublicKey(
    "txpz2XfHsfoFikK37nK1hszFXbJfRsNK3BVbzyHnYPT"
  );

  const usdcMint =
    process.env.cluster === "devnet" || process.env.cluster === "d"
      ? usdcMintDevnet
      : usdcMintMainnet;

  console.log("Using usdc mint " + usdcMint.toBase58());

  //scratchpad code for deleting purchases for a wallet
  // const purchases = await program.account.purchase.all();
  // for (const purchase of purchases) {
  //   if (purchase.account.owner.toBase58() === "2Vr9vsz365wYNh19NMpHnJRuarepjBXhTkCgk8WASywN") {
  //     console.log(`Deleting purchase ${purchase.publicKey.toBase58()}`);
  //     await program.methods.deletePurchase(true).accountsPartial({
  //       purchase: purchase.publicKey,
  //       product: purchase.account.product,
  //       refundee: authority,
  //     }).rpc();
  //     console.log(`Deleted purchase ${purchase.publicKey.toBase58()}`);
  //   }
  // }

  // Init program
  /*await program.methods
    .initializeProgram(authority, stepFeeWallet)
    .accountsPartial({
      payer: authority,
    })
    .rpc();*/

  /*console.log("Creating tax year 2020");
  await createTaxYear(2020, program, usdcMint, authority);
  console.log("Creating tax year 2021");
  await createTaxYear(2021, program, usdcMint, authority);
  console.log("Creating tax year 2022");
  await createTaxYear(2022, program, usdcMint, authority);
  console.log("Creating tax year 2023");
  await createTaxYear(2023, program, usdcMint, authority);
  console.log("Creating tax year 2024");
  await createTaxYear(2024, program, usdcMint, authority);
  console.log("Creating tax year 2025");
  await createTaxYear(2025, program, usdcMint, authority);*/
  console.log("Complete");
};

async function createTaxYear(
  year: number,
  program: anchor.Program<StepSubscriptions>,
  usdcMint: anchor.web3.PublicKey,
  authority: anchor.web3.PublicKey
) {
  const productTXTier1Key = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("txs" + year + "-10")],
    program.programId
  )[0];

  const productTXTier2Key = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("txs" + year + "-20")],
    program.programId
  )[0];

  const productTXTier3Key = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("txs" + year + "-30")],
    program.programId
  )[0];

  const productTXTier4Key = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("txs" + year + "-40")],
    program.programId
  )[0];

  await program.methods
    .createProduct(
      "txs" + year + "-10",
      "Tier 1",
      "Tier 1 tx history for " + year,
      "txs",
      "txs" + year,
      usdcMint,
      new anchor.BN(7500000),
      null,
      1,
      ["txs", "txs" + year, "txs-10", "txs" + year + "-10"]
    )
    .accountsPartial({
      payer: authority,
      authority: authority,
    })
    .rpc();

  await program.methods
    .updateProductCost(new anchor.BN(7500000))
    .accountsPartial({
      authority: authority,
      product: productTXTier1Key,
    })
    .rpc();
  await program.methods
    .updateProductI64A5([
      new anchor.BN(250),
      new anchor.BN(year),
      new anchor.BN(0),
      new anchor.BN(0),
      new anchor.BN(0),
    ])
    .accountsPartial({
      authority: authority,
      product: productTXTier1Key,
    })
    .rpc();
  await program.methods
    .updateProductActiveState(true)
    .accountsPartial({
      authority: authority,
      product: productTXTier1Key,
    })
    .rpc();
  await program.methods
    .updateProductMint(usdcMint)
    .accountsPartial({
      authority: authority,
      product: productTXTier1Key,
    })
    .rpc();

  await program.methods
    .createProduct(
      "txs" + year + "-20",
      "Tier 2",
      "Tier 2 tx history for " + year,
      "txs",
      "txs" + year,
      usdcMint,
      new anchor.BN(20000000),
      null,
      1,
      ["txs", "txs" + year, "txs-20", "txs" + year + "-20"]
    )
    .accountsPartial({
      payer: authority,
      authority: authority,
    })
    .rpc();

  await program.methods
    .updateProductCost(new anchor.BN(20000000))
    .accountsPartial({
      authority: authority,
      product: productTXTier2Key,
    })
    .rpc();
  await program.methods
    .updateProductI64A5([
      new anchor.BN(1000),
      new anchor.BN(year),
      new anchor.BN(0),
      new anchor.BN(0),
      new anchor.BN(0),
    ])
    .accountsPartial({
      authority: authority,
      product: productTXTier2Key,
    })
    .rpc();
  await program.methods
    .updateProductActiveState(true)
    .accountsPartial({
      authority: authority,
      product: productTXTier2Key,
    })
    .rpc();
  await program.methods
    .updateProductMint(usdcMint)
    .accountsPartial({
      authority: authority,
      product: productTXTier2Key,
    })
    .rpc();

  await program.methods
    .createProduct(
      "txs" + year + "-30",
      "Tier 3",
      "Tier 3 tx history for " + year,
      "txs",
      "txs" + year,
      usdcMint,
      new anchor.BN(50000000),
      null,
      1,
      ["txs", "txs" + year, "txs-30", "txs" + year + "-30"]
    )
    .accountsPartial({
      payer: authority,
      authority: authority,
    })
    .rpc();

  await program.methods
    .updateProductCost(new anchor.BN(50000000))
    .accountsPartial({
      authority: authority,
      product: productTXTier3Key,
    })
    .rpc();
  await program.methods
    .updateProductI64A5([
      new anchor.BN(3000),
      new anchor.BN(year),
      new anchor.BN(0),
      new anchor.BN(0),
      new anchor.BN(0),
    ])
    .accountsPartial({
      authority: authority,
      product: productTXTier3Key,
    })
    .rpc();
  await program.methods
    .updateProductActiveState(true)
    .accountsPartial({
      authority: authority,
      product: productTXTier3Key,
    })
    .rpc();
  await program.methods
    .updateProductMint(usdcMint)
    .accountsPartial({
      authority: authority,
      product: productTXTier3Key,
    })
    .rpc();

  await program.methods
    .createProduct(
      "txs" + year + "-40",
      "Tier 4",
      "Tier 4 tx history for " + year,
      "txs",
      "txs" + year,
      usdcMint,
      new anchor.BN(250000000),
      null,
      1,
      ["txs", "txs" + year, "txs-40", "txs" + year + "-40"]
    )
    .accountsPartial({
      payer: authority,
      authority: authority,
    })
    .rpc();

  await program.methods
    .updateProductCost(new anchor.BN(250000000))
    .accountsPartial({
      authority: authority,
      product: productTXTier4Key,
    })
    .rpc();
  await program.methods
    .updateProductI64A5([
      new anchor.BN(10_000_000),
      new anchor.BN(year),
      new anchor.BN(0),
      new anchor.BN(0),
      new anchor.BN(0),
    ])
    .accountsPartial({
      authority: authority,
      product: productTXTier4Key,
    })
    .rpc();
  await program.methods
    .updateProductActiveState(true)
    .accountsPartial({
      authority: authority,
      product: productTXTier4Key,
    })
    .rpc();
  await program.methods
    .updateProductMint(usdcMint)
    .accountsPartial({
      authority: authority,
      product: productTXTier4Key,
    })
    .rpc();
}
