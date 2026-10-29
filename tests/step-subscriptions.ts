import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import * as token from "@solana/spl-token";
import { assert } from "chai";
import { StepSubscriptions } from "../target/types/step_subscriptions";
import { PublicKey } from "@solana/web3.js";

const DEFAULT_PUBKEY = anchor.web3.PublicKey.default;
const I64_MAX = new anchor.BN("9223372036854775807");

//utils
function sendLamportsIx(
  fromPublicKey: anchor.web3.PublicKey,
  publicKey: anchor.web3.PublicKey,
  amount: number
): anchor.web3.TransactionInstruction {
  return anchor.web3.SystemProgram.transfer({
    fromPubkey: fromPublicKey,
    toPubkey: publicKey,
    lamports: amount,
  });
}

async function asyncForEach<T>(
  iterable: Iterable<T>,
  callback: (item: T, index: number) => Promise<void>
): Promise<void> {
  let i = 0;
  for (let item of iterable) await callback(await item, i++);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sumBN(arr: anchor.BN[]): anchor.BN {
  return arr.reduce((a, b) => a.add(b), new anchor.BN(0));
}

const ONE_MONTH_SECS = 60 * 60 * 24 * 30;
const SIXTY_SECS = 60;
const TWENTY_SECS = 20;

describe("step-subscriptions", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace
    .StepSubscriptions as Program<StepSubscriptions>;
  const provider = program.provider as anchor.AnchorProvider;
  const bootstrapAccounts = {
    upgradeAuthority: provider.wallet.publicKey,
    program: program.programId,
    programData: PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
    )[0],
  };

  const usdcMintKeypair = anchor.web3.Keypair.generate();
  const usdcMint = usdcMintKeypair.publicKey;
  const globalState = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    program.programId
  )[0];

  const productSKU100 = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("SKU100")],
    program.programId
  )[0];

  const productSKU101 = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("SKU101")],
    program.programId
  )[0];

  const productSKUFast = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("SKUFAST")],
    program.programId
  )[0];

  const productTX2022BasicKey = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("txs2022-basic")],
    program.programId
  )[0];

  const productTX2022ProKey = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("txs2022-pro")],
    program.programId
  )[0];

  const productTX2022EnterpriseKey = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("txs2022-ent")],
    program.programId
  )[0];

  const productAPIBasicKey = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("api-basic")],
    program.programId
  )[0];

  const productAPIProKey = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("api-pro")],
    program.programId
  )[0];

  const productAPIEnterpriseKey = PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from("api-ent")],
    program.programId
  )[0];

  const admins = {
    real: anchor.web3.Keypair.generate(),
    malicious: anchor.web3.Keypair.generate(),
  };

  const actors = {
    alice: anchor.web3.Keypair.generate(),
    bob: anchor.web3.Keypair.generate(),
    joe: anchor.web3.Keypair.generate(),
    malicious: anchor.web3.Keypair.generate(),
  };

  const treasuryWallet = anchor.web3.Keypair.generate();

  let paymentTokenAccount;
  let treasuryTokenAccounts = {
    real: null as anchor.web3.PublicKey,
    malicious: null as anchor.web3.PublicKey,
  };

  let purchaserTokenAccounts = {
    alice: null as anchor.web3.PublicKey,
    bob: null as anchor.web3.PublicKey,
    joe: null as anchor.web3.PublicKey,
    malicious: null as anchor.web3.PublicKey,
  };

  before("Setup", async () => {
    //send actors 1 SOL
    const freeMoneyTx = new anchor.web3.Transaction();
    freeMoneyTx.add(
      sendLamportsIx(
        provider.wallet.publicKey,
        admins.real.publicKey,
        1_000_000_000
      ),
      sendLamportsIx(
        provider.wallet.publicKey,
        admins.malicious.publicKey,
        1_000_000_000
      ),
      sendLamportsIx(
        provider.wallet.publicKey,
        actors.alice.publicKey,
        1_000_000_000
      ),
      sendLamportsIx(
        provider.wallet.publicKey,
        actors.bob.publicKey,
        1_000_000_000
      ),
      sendLamportsIx(
        provider.wallet.publicKey,
        actors.joe.publicKey,
        1_000_000_000
      ),
      sendLamportsIx(
        provider.wallet.publicKey,
        actors.malicious.publicKey,
        1_000_000_000
      )
    );
    await provider.sendAndConfirm(freeMoneyTx);

    await token.createMint(
      provider.connection,
      admins.real,
      admins.real.publicKey,
      admins.real.publicKey,
      9,
      usdcMintKeypair
    );

    //give all the actors enough to purchase products
    purchaserTokenAccounts.alice = await token.createAssociatedTokenAccount(
      provider.connection,
      actors.alice,
      usdcMint,
      actors.alice.publicKey
    );
    await token.mintTo(
      provider.connection,
      admins.real,
      usdcMint,
      purchaserTokenAccounts.alice,
      admins.real,
      100_000_000_000
    );
    purchaserTokenAccounts.bob = await token.createAssociatedTokenAccount(
      provider.connection,
      actors.bob,
      usdcMint,
      actors.bob.publicKey
    );
    await token.mintTo(
      provider.connection,
      admins.real,
      usdcMint,
      purchaserTokenAccounts.bob,
      admins.real,
      100_000_000_000
    );
    purchaserTokenAccounts.joe = await token.createAssociatedTokenAccount(
      provider.connection,
      actors.joe,
      usdcMint,
      actors.joe.publicKey
    );
    await token.mintTo(
      provider.connection,
      admins.real,
      usdcMint,
      purchaserTokenAccounts.joe,
      admins.real,
      100_000_000_000
    );
    purchaserTokenAccounts.malicious = await token.createAssociatedTokenAccount(
      provider.connection,
      actors.malicious,
      usdcMint,
      actors.malicious.publicKey
    );
    await token.mintTo(
      provider.connection,
      admins.real,
      usdcMint,
      purchaserTokenAccounts.malicious,
      admins.real,
      100_000_000_000
    );

    //create the treasury payment token account
    paymentTokenAccount = await token.createAssociatedTokenAccount(
      provider.connection,
      admins.real,
      usdcMint,
      admins.real.publicKey
    );

    //give admins "usdc" token
    treasuryTokenAccounts.real = paymentTokenAccount;
    treasuryTokenAccounts.malicious = await token.createAssociatedTokenAccount(
      provider.connection,
      admins.malicious,
      usdcMint,
      admins.malicious.publicKey
    );
  });

  describe("Global State", () => {
    it("Program initialized", async () => {
      let g = await program.account.globalState.fetchNullable(globalState);
      assert.isNull(g);

      await program.methods
        .initializeProgram(admins.real.publicKey, treasuryWallet.publicKey)
        .accountsPartial({
          ...bootstrapAccounts,
          payer: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.authorities[0].toBase58(),
        admins.real.publicKey.toBase58()
      );
      assert.equal(g.authorities[1].toBase58(), DEFAULT_PUBKEY.toBase58());
      assert.equal(
        g.paymentWallet.toBase58(),
        treasuryWallet.publicKey.toBase58()
      );
    });

    it("Program cannot reinitialize", async () => {
      let g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.authorities[0].toBase58(),
        admins.real.publicKey.toBase58()
      );
      assert.equal(g.authorities[1].toBase58(), DEFAULT_PUBKEY.toBase58());
      assert.equal(
        g.paymentWallet.toBase58(),
        treasuryWallet.publicKey.toBase58()
      );

      //try with original user
      await asyncForEach([admins.real, admins.malicious], (executorKey) => {
        return program.methods
          .initializeProgram(executorKey.publicKey, treasuryWallet.publicKey)
          .accountsPartial({
            ...bootstrapAccounts,
            payer: executorKey.publicKey,
          })
          .signers([executorKey])
          .rpc()
          .then(
            (_) => {
              throw "should have failed";
            },
            (a) => {
              assert.isTrue(
                a.logs.some((line: string) => line.includes("already in use")),
                JSON.stringify(a.logs)
              );
            }
          );
      });

      g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.authorities[0].toBase58(),
        admins.real.publicKey.toBase58()
      );
      assert.equal(g.authorities[1].toBase58(), DEFAULT_PUBKEY.toBase58());
      assert.equal(
        g.paymentWallet.toBase58(),
        treasuryWallet.publicKey.toBase58()
      );
    });

    it("Change state authority", async () => {
      let g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.authorities[0].toBase58(),
        admins.real.publicKey.toBase58()
      );
      assert.equal(g.authorities[1].toBase58(), DEFAULT_PUBKEY.toBase58());
      assert.equal(
        g.paymentWallet.toBase58(),
        treasuryWallet.publicKey.toBase58()
      );

      //malicious dude can't change
      await program.methods
        .updateStateAuthority(admins.malicious.publicKey, 1, false)
        .accountsPartial({
          authority: admins.malicious.publicKey,
        })
        .signers([admins.malicious])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidAuthority");
          }
        );

      //temp make alice and bob admins
      await program.methods
        .updateStateAuthority(actors.bob.publicKey, 1, false)
        .accountsPartial({
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      // removing self
      await program.methods
        .updateStateAuthority(actors.alice.publicKey, 0, true)
        .accountsPartial({
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.authorities[0].toBase58(),
        actors.alice.publicKey.toBase58()
      );
      assert.equal(
        g.authorities[1].toBase58(),
        actors.bob.publicKey.toBase58()
      );
      assert.equal(
        g.paymentWallet.toBase58(),
        treasuryWallet.publicKey.toBase58()
      );

      //now admin can't change back
      await program.methods
        .updateStateAuthority(admins.real.publicKey, 0, false)
        .accountsPartial({
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidAuthority");
          }
        );

      //bob is nice and set back
      await program.methods
        .updateStateAuthority(admins.real.publicKey, 0, false)
        .accountsPartial({
          authority: actors.bob.publicKey,
        })
        .signers([actors.bob])
        .rpc();

      g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.authorities[0].toBase58(),
        admins.real.publicKey.toBase58()
      );
      assert.equal(
        g.authorities[1].toBase58(),
        actors.bob.publicKey.toBase58()
      );
      assert.equal(
        g.paymentWallet.toBase58(),
        treasuryWallet.publicKey.toBase58()
      );
    });

    it("Change payment wallet", async () => {
      let g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.authorities[0].toBase58(),
        admins.real.publicKey.toBase58()
      );
      assert.equal(
        g.authorities[1].toBase58(),
        actors.bob.publicKey.toBase58()
      );
      assert.equal(
        g.paymentWallet.toBase58(),
        treasuryWallet.publicKey.toBase58()
      );

      await program.methods
        .updateStatePaymentWallet(actors.alice.publicKey)
        .accountsPartial({
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.paymentWallet.toBase58(),
        actors.alice.publicKey.toBase58()
      );

      await program.methods
        .updateStatePaymentWallet(actors.malicious.publicKey)
        .accountsPartial({
          authority: actors.malicious.publicKey,
        })
        .signers([actors.malicious])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidAuthority");
          }
        );

      g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.paymentWallet.toBase58(),
        actors.alice.publicKey.toBase58()
      );

      // reset back to treasury
      await program.methods
        .updateStatePaymentWallet(admins.real.publicKey)
        .accountsPartial({
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      g = await program.account.globalState.fetch(globalState);
      assert.equal(
        g.paymentWallet.toBase58(),
        admins.real.publicKey.toBase58()
      );
    });
  });

  describe("Product", () => {
    it("Validate string attributes", async () => {
      await program.methods
        .createProduct(
          "SKU10000000000000",
          "Test Product",
          "Product Description",
          "Family",
          "FooGroup",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidLengthCode");
          }
        );

      await program.methods
        .createProduct(
          "SKU100",
          "TestProduct0000000000000000000000",
          "Product Description",
          "Family",
          "FooGroup",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidLengthName");
          }
        );

      await program.methods
        .createProduct(
          "SKU100",
          "TestProduct",
          "ProductDescriptionProductDescriptionProductDescriptionProductDescriptionProductDescriptionProductDescriptionProductDescription000",
          "Family",
          "FooGroup",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidLengthBlurb");
          }
        );

      await program.methods
        .createProduct(
          "SKU100",
          "TestProduct",
          "Product Description",
          "Family000000000000000000000000000",
          "FooGroup",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidLengthFamily");
          }
        );

      await program.methods
        .createProduct(
          "SKU100",
          "TestProduct",
          "Product Description",
          "Family",
          "UpgradeGroup012345678901234567890",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidLengthUpgradeGroup");
          }
        );
    });

    it("Max account space", async () => {
      await program.methods
        .createProduct(
          "SKU1000000000000",
          "TestProduct000000000000000000000",
          "ProductDescriptionProductDescriptionProductDescriptionProductDescriptionProductDescriptionProductDescriptionProductDescription00",
          "Family00000000000000000000000000",
          "UpgradeGroup01234567890123456789",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          [
            "0123456789",
            "0123456789",
            "0123456789",
            "0123456789",
            "0123456789",
            "0123456789",
            "0123456789",
            "0123456789",
            "0123456789",
            "0123456789",
          ]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();
    });

    it("Create a product", async () => {
      await program.methods
        .createProduct(
          "SKU100",
          "Test Product",
          "Product Description",
          "Family",
          "FooGroup",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      let sku100 = await program.account.product.fetch(productSKU100);
      assert.equal(sku100.code16, "SKU100");
      assert.equal(sku100.name32, "Test Product");
      assert.equal(sku100.blurb128, "Product Description");
      assert.equal(sku100.family32, "Family");
      assert.equal(sku100.costMint.toBase58(), usdcMint.toBase58());
      assert.equal(
        sku100.cost.toString(),
        new anchor.BN(1_000_000_000).toString()
      );
      assert.equal(
        sku100.purchaseDurationSecs.toNumber(),
        new anchor.BN(ONE_MONTH_SECS).toNumber()
      );
      assert.equal(sku100.active, false);
    });

    it("Bad guys can't create products", async () => {
      // bad guys trying to pull a fast one
      await program.methods
        .createProduct(
          "SKU101",
          "Fake product",
          "Fake product description",
          "Fake familia",
          "FooGroup",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.malicious.publicKey,
          authority: admins.malicious.publicKey,
        })
        .signers([admins.malicious])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidAuthority");
          }
        );
    });

    it("Create another product", async () => {
      await program.methods
        .createProduct(
          "SKU101",
          "Test Product 2",
          "Product Description 2",
          "Family 2",
          "FooGroup",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(ONE_MONTH_SECS),
          6,
          ["API2"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      let sku101 = await program.account.product.fetch(productSKU101);
      assert.equal(sku101.code16, "SKU101");
      assert.equal(sku101.name32, "Test Product 2");
      assert.equal(sku101.blurb128, "Product Description 2");
      assert.equal(sku101.family32, "Family 2");
      assert.equal(sku101.costMint.toBase58(), usdcMint.toBase58());
      assert.equal(
        sku101.cost.toString(),
        new anchor.BN(1_000_000_000).toString()
      );
      assert.equal(
        sku101.purchaseDurationSecs.toNumber(),
        new anchor.BN(ONE_MONTH_SECS).toNumber()
      );
      assert.equal(sku101.active, false);
    });

    it("Activate products", async () => {
      let sku100 = await program.account.product.fetch(productSKU100);
      assert.equal(sku100.active, false);
      let sku101 = await program.account.product.fetch(productSKU101);
      assert.equal(sku101.active, false);

      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU100,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU101,
        })
        .signers([admins.real])
        .rpc();

      sku100 = await program.account.product.fetch(productSKU100);
      assert.equal(sku100.active, true);
      sku101 = await program.account.product.fetch(productSKU101);
      assert.equal(sku101.active, true);
    });

    it("Can update assigned roles", async () => {
      let sku100 = await program.account.product.fetch(productSKU100);
      assert.equal(sku100.assignedRoles6A10[0].toString(), "API");
      for (let i = 1; i < 10; i++) {
        assert.equal(sku100.assignedRoles6A10[i], undefined);
      }

      await program.methods
        .updateProductAssignedRoles([
          "API",
          "200",
          "300",
          "400",
          "500",
          "600",
          "700",
          "800",
          "900",
          "1000",
        ])
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU100,
        })
        .signers([admins.real])
        .rpc();

      sku100 = await program.account.product.fetch(productSKU100);
      assert.equal(sku100.assignedRoles6A10[0].toString(), "API");
      for (let i = 1; i < 10; i++) {
        assert.equal(
          sku100.assignedRoles6A10[i].toString(),
          ((i + 1) * 100).toString()
        );
      }
    });

    it("Can update free fields", async () => {
      let sku100 = await program.account.product.fetch(productSKU100);
      for (let i = 0; i < 5; i++) {
        assert.equal(sku100.i64A5[i].toString(), "0");
      }

      for (let i = 0; i < 5; i++) {
        assert.equal(sku100.str20A5[i], undefined);
      }

      await program.methods
        .updateProductI64A5([
          new anchor.BN(1),
          new anchor.BN(2),
          new anchor.BN(3),
          new anchor.BN(4),
          new anchor.BN(5),
        ])
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU100,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .updateProductStr(["1", "2", "3", "4", "5"])
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU100,
        })
        .signers([admins.real])
        .rpc();

      sku100 = await program.account.product.fetch(productSKU100);
      for (let i = 0; i < 5; i++) {
        assert.equal(
          sku100.i64A5[i].toString(),
          new anchor.BN(i + 1).toString()
        );
      }

      for (let i = 0; i < 5; i++) {
        assert.equal(sku100.str20A5[i], (i + 1).toString());
      }
    });
  });

  describe("Purchase", () => {
    it("Cannot purchase inactive product", async () => {
      let sku100 = await program.account.product.fetch(productSKU100);
      assert.equal(sku100.code16, "SKU100");

      // Can't purchase inactive products
      await program.methods
        .updateProductActiveState(false)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU100,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKU100,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InactiveProduct");
          }
        );

      // Re-activate
      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU100,
        })
        .signers([admins.real])
        .rpc();
    });

    it("Cannot purchase more then max ownable", async () => {
      await program.methods
        .purchaseProduct(13)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKU100,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "MaxPurchaseQtyReached");
          }
        );

      // Buy half the max
      const result = await program.methods
        .purchaseProduct(6)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKU100,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseSKU100 = result.pubkeys.purchase;

      let purchaseSku100 = await program.account.purchase.fetch(purchaseSKU100);
      // use a little under 6 months to confirm expiry is set correctly
      assert.isAtLeast(
        purchaseSku100.expiresTs.toNumber(),
        Date.now() / 1000 + ONE_MONTH_SECS * 5.99
      );

      // Try buy max+1
      await program.methods
        .purchaseProduct(7)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKU100,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "MaxPurchaseQtyReached");
          }
        );
    });

    it("Can purchase more after expiry", async () => {
      await program.methods
        .createProduct(
          "SKUFAST",
          "TestProduct",
          "Product Description",
          "Family",
          null,
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(3),
          4,
          ["API2"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKUFast,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .purchaseProduct(4)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKUFast,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc();

      await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKUFast,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "MaxPurchaseQtyReached");
          }
        );

      // wait for expiry of 1st purchase
      await sleep(4_000);

      await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKUFast,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc();

      // Try buy max+1 again
      await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKUFast,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "MaxPurchaseQtyReached");
          }
        );
    });

    it("Can purchase", async () => {
      let product = await program.account.product.fetch(productSKU100);
      const priorQty = product.purchaseQty.toNumber();
      const priorRev = product.purchaseRevenue.toNumber();

      const result = await program.methods
        .purchaseProduct(2)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKU100,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseSKU100 = result.pubkeys.purchase;

      let purchase = await program.account.purchase.fetch(purchaseSKU100);
      assert.equal(
        purchase.owner.toBase58(),
        actors.alice.publicKey.toBase58()
      );
      assert.equal(purchase.product.toBase58(), productSKU100.toBase58());
      assert.equal(
        sumBN(purchase.history10.map((h) => h.amountPaid)).toString(),
        new anchor.BN(8_000_000_000).toString()
      );
      // use a little under 8 months to confirm expiry was increased from 6 to 8 months
      assert.isAtLeast(
        purchase.expiresTs.toNumber(),
        Date.now() / 1000 + ONE_MONTH_SECS * 7.99
      );

      //check the aggregate was updated
      product = await program.account.product.fetch(productSKU100);
      assert.equal(product.purchaseQty.toNumber(), priorQty + 2, "purchaseQty");
      assert.equal(
        product.purchaseRevenue.toNumber(),
        priorRev + 2_000_000_000,
        "purchaseRevenue"
      );
    });

    it("Can purchase at discount", async () => {
      // Set 25% discount for 6 month purchase
      await program.methods
        .updateProductDiscount(new anchor.BN(2500), 6)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productSKU101,
        })
        .signers([admins.real])
        .rpc();

      const result = await program.methods
        .purchaseProduct(6)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKU101,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseSKU101 = result.pubkeys.purchase;

      let purchase = await program.account.purchase.fetch(purchaseSKU101);
      assert.equal(
        purchase.owner.toBase58(),
        actors.alice.publicKey.toBase58()
      );
      assert.equal(purchase.product.toBase58(), productSKU101.toBase58());
      assert.equal(
        purchase.history10[0].amountPaid.toString(),
        new anchor.BN(4_500_000_000).toString()
      );
    });

    it("Cannot purchase more than max duration", async () => {
      await program.methods
        .purchaseProduct(3)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productSKU101,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "MaxPurchaseQtyReached");
          }
        );
    });
  });

  describe("Upgradable Non Expirable Purchases", () => {
    it("Can create product upgrade group", async () => {
      await program.methods
        .createProduct(
          "txs2022-basic",
          "TXs 2022 Basic",
          "Basic tier for 2022",
          "txs",
          "txs2022",
          usdcMint,
          new anchor.BN(1_000_000_000),
          null,
          1,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();
      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productTX2022BasicKey,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .createProduct(
          "txs2022-pro",
          "TXs 2022 Pro",
          "Pro tier for 2022",
          "txs",
          "txs2022",
          usdcMint,
          new anchor.BN(2_000_000_000),
          null,
          1,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();
      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productTX2022ProKey,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .createProduct(
          "txs2022-ent",
          "TXs 2022 enterprise",
          "Enterprise tier for 2022",
          "txs",
          "txs2022",
          usdcMint,
          new anchor.BN(5_000_000_000),
          null,
          1,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();
      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productTX2022EnterpriseKey,
        })
        .signers([admins.real])
        .rpc();
    });

    it("Can purchase initial product", async () => {
      const result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productTX2022BasicKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseTX2022BasicKey = result.pubkeys.purchase;

      let purchaseBasic = await program.account.purchase.fetch(
        purchaseTX2022BasicKey
      );
      assert.equal(purchaseBasic.expiresTs.toString(), I64_MAX.toString());
      assert.equal(purchaseBasic.history10[0].quantity, 1);
      assert.equal(
        purchaseBasic.history10[0].amountPaid.toNumber(),
        1_000_000_000
      );
    });

    it("Can upgrade initial product", async () => {
      const purchaseTX2022BasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productTX2022BasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      // upgrade to pro
      const result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productTX2022ProKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          {
            pubkey: productTX2022BasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseTX2022BasicKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseTX2022ProKey = result.pubkeys.purchase;
      let purchasePro =
        await program.account.purchase.fetch(purchaseTX2022ProKey);
      assert.equal(purchasePro.expiresTs.toString(), I64_MAX.toString());
      assert.equal(purchasePro.history10[0].quantity, 1);
      assert.equal(
        purchasePro.history10[0].amountPaid.toNumber(),
        1_000_000_000
      );
    });

    it("Can upgrade to final product", async () => {
      const purchaseTX2022BasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productTX2022BasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      const purchaseTX2022ProKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productTX2022ProKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      // upgrade to enterprise
      const result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productTX2022EnterpriseKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          {
            pubkey: productTX2022BasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseTX2022BasicKey,
            isWritable: true,
            isSigner: false,
          },
          {
            pubkey: productTX2022ProKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseTX2022ProKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseTX2022EnterpriseKey = result.pubkeys.purchase;

      let purchaseEnterprise = await program.account.purchase.fetch(
        purchaseTX2022EnterpriseKey
      );
      assert.equal(purchaseEnterprise.expiresTs.toString(), I64_MAX.toString());
      assert.equal(purchaseEnterprise.history10[0].quantity, 1);
      assert.equal(
        purchaseEnterprise.history10[0].amountPaid.toNumber(),
        3_000_000_000
      );
    });

    it("Can upgrade to final product without previous tiers", async () => {
      let result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.bob.publicKey,
          owner: actors.bob.publicKey,
          regarding: actors.bob.publicKey,
          product: productTX2022BasicKey,
          paymentFromTokenAccount: purchaserTokenAccounts.bob,
          paymentFromTokenAuthority: actors.bob.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.bob])
        .rpcAndKeys();

      const purchaseTX2022BasicKey = result.pubkeys.purchase;

      let purchaseBasic = await program.account.purchase.fetch(
        purchaseTX2022BasicKey
      );
      assert.equal(purchaseBasic.expiresTs.toString(), I64_MAX.toString());
      assert.equal(purchaseBasic.history10[0].quantity, 1);
      assert.equal(
        purchaseBasic.history10[0].amountPaid.toNumber(),
        1_000_000_000
      );

      // upgrade to enterprise
      result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.bob.publicKey,
          owner: actors.bob.publicKey,
          regarding: actors.bob.publicKey,
          product: productTX2022EnterpriseKey,
          paymentFromTokenAccount: purchaserTokenAccounts.bob,
          paymentFromTokenAuthority: actors.bob.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          {
            pubkey: productTX2022BasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseTX2022BasicKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.bob])
        .rpcAndKeys();

      const purchaseTX2022EnterpriseKey = result.pubkeys.purchase;

      let purchaseEnterprise = await program.account.purchase.fetch(
        purchaseTX2022EnterpriseKey
      );
      assert.equal(purchaseEnterprise.expiresTs.toString(), I64_MAX.toString());
      assert.equal(purchaseEnterprise.history10[0].quantity, 1);
      assert.equal(
        purchaseEnterprise.history10[0].amountPaid.toNumber(),
        4_000_000_000
      );
    });
  });

  describe("Upgradable Expirable Purchases", () => {
    it("Can create product upgrade group", async () => {
      await program.methods
        .createProduct(
          "api-basic",
          "API Basic",
          "Basic tier",
          "txs",
          "api",
          usdcMint,
          new anchor.BN(1_000_000_000),
          new anchor.BN(TWENTY_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();
      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productAPIBasicKey,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .createProduct(
          "api-pro",
          "API Pro",
          "Pro tier",
          "txs",
          "api",
          usdcMint,
          new anchor.BN(3_000_000_000),
          new anchor.BN(TWENTY_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();
      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productAPIProKey,
        })
        .signers([admins.real])
        .rpc();

      await program.methods
        .createProduct(
          "api-ent",
          "API Enterprise",
          "Enterprise tier",
          "txs",
          "api",
          usdcMint,
          new anchor.BN(5_000_000_000),
          new anchor.BN(TWENTY_SECS),
          12,
          ["API"]
        )
        .accountsPartial({
          payer: admins.real.publicKey,
          authority: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();
      await program.methods
        .updateProductActiveState(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          product: productAPIEnterpriseKey,
        })
        .signers([admins.real])
        .rpc();
    });

    it("Can purchase initial product", async () => {
      const result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productAPIBasicKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseAPIBasicKey = result.pubkeys.purchase;

      let purchaseBasic =
        await program.account.purchase.fetch(purchaseAPIBasicKey);

      assert.isAtLeast(
        purchaseBasic.expiresTs.toNumber(),
        Date.now() / 1000 + TWENTY_SECS - 2
      );
      assert.equal(purchaseBasic.history10.length, 1);
      assert.equal(purchaseBasic.history10[0].quantity, 1);
      assert.equal(
        purchaseBasic.history10[0].amountPaid.toNumber(),
        1_000_000_000
      );
      assert.isAtLeast(
        purchaseBasic.history10[0].purchasedTs.toNumber(),
        Date.now() / 1000 - 5
      );
    });

    it("Can upgrade initial product", async () => {
      const purchaseAPIBasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIBasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      // wait for ~10 seconds
      await sleep(10_000);

      // upgrade to pro
      const result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productAPIProKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          {
            pubkey: productAPIBasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseAPIBasicKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseAPIProKey = result.pubkeys.purchase;

      let purchaseBasic =
        await program.account.purchase.fetch(purchaseAPIBasicKey);
      let purchasePro = await program.account.purchase.fetch(purchaseAPIProKey);

      assert.isAtLeast(
        purchaseBasic.history10[0].refunded.toNumber(),
        1_000_000_000 * (1 / 2) - 500
      );

      assert.isAtLeast(
        purchasePro.expiresTs.toNumber(),
        Date.now() / 1000 + TWENTY_SECS - 2
      );

      assert.equal(purchasePro.history10.length, 1);
      assert.equal(purchasePro.history10[0].quantity, 1);
      // math based on 10 seconds of basic tier
      // 20 second duration, 10 seconds elapsed, half of the cost of the basic tier (1_000_000_000)
      assert.isAtMost(
        purchasePro.history10[0].amountPaid.toNumber(),
        Math.trunc(3_000_000_000 - 1_000_000_000 * (1 / 2)) + 10
      );
      assert.isAtLeast(
        purchasePro.history10[0].purchasedTs.toNumber(),
        Date.now() / 1000 - 5
      );
    });

    it("No double refunds", async () => {
      const purchaseAPIBasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIBasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      // buy another pro plan
      const result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productAPIProKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          {
            pubkey: productAPIBasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseAPIBasicKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseAPIProKey = result.pubkeys.purchase;

      let purchasePro = await program.account.purchase.fetch(purchaseAPIProKey);

      assert.isAtLeast(
        purchasePro.expiresTs.toNumber(),
        Date.now() / 1000 + TWENTY_SECS - 2
      );

      assert.equal(purchasePro.history10.length, 2);
      assert.equal(purchasePro.history10[0].quantity, 1);
      assert.equal(purchasePro.history10[1].quantity, 1);
      // math based on ~10 seconds of basic tier
      // 20 second duration, 10 seconds elapsed, half of the cost of the basic tier (1_000_000_000)
      assert.isAtLeast(
        purchasePro.history10[0].amountPaid.toNumber(),
        Math.trunc(3_000_000_000 - 1_000_000_000 * (1 / 2)) - 5_000
      );
      assert.isAtLeast(
        purchasePro.history10[1].amountPaid.toNumber(),
        3_000_000_000
      );
      assert.isAtLeast(
        purchasePro.history10[0].purchasedTs.toNumber(),
        Date.now() / 1000 - 35
      );
      assert.isAtLeast(
        purchasePro.history10[1].purchasedTs.toNumber(),
        Date.now() / 1000 - 5
      );
    });

    it("Cannot upgrade using expired purchase", async () => {
      const purchaseAPIBasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIBasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      const purchaseAPIProKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIProKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      await sleep(50_000);

      // upgrade to enterprise
      const result = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productAPIEnterpriseKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          {
            pubkey: productAPIBasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseAPIBasicKey,
            isWritable: true,
            isSigner: false,
          },
          {
            pubkey: productAPIProKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseAPIProKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.alice])
        .rpcAndKeys();

      const purchaseAPIEnterpriseKey = result.pubkeys.purchase;

      let purchaseEnterprise = await program.account.purchase.fetch(
        purchaseAPIEnterpriseKey
      );

      assert.isAtLeast(
        purchaseEnterprise.expiresTs.toNumber(),
        Date.now() / 1000 + TWENTY_SECS - 2
      );

      assert.equal(purchaseEnterprise.history10.length, 1);
      assert.equal(purchaseEnterprise.history10[0].quantity, 1);
      assert.equal(
        purchaseEnterprise.history10[0].amountPaid.toNumber(),
        5_000_000_000
      );
      assert.isAtLeast(
        purchaseEnterprise.history10[0].purchasedTs.toNumber(),
        Date.now() / 1000 - 5
      );
    });

    it("Cannot downgrade (no refunds)", async () => {
      const purchaseAPIBasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIBasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      const purchaseAPIEnterpriseKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIEnterpriseKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      // downgrade to pro
      await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.alice.publicKey,
          owner: actors.alice.publicKey,
          regarding: actors.alice.publicKey,
          product: productAPIProKey,
          paymentFromTokenAccount: purchaserTokenAccounts.alice,
          paymentFromTokenAuthority: actors.alice.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          {
            pubkey: productAPIBasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseAPIBasicKey,
            isWritable: true,
            isSigner: false,
          },
          {
            pubkey: productAPIEnterpriseKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseAPIEnterpriseKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "DowngradesNotSupported");
          }
        );
    });

    it("Admin can delete a purchase", async () => {
      let product = await program.account.product.fetchNullable(
        productAPIEnterpriseKey
      );
      assert.isNotNull(product);
      const preQty = product.purchaseQty.toNumber();
      const preRev = product.purchaseRevenue.toNumber();

      const purchaseAPIEnterpriseKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIEnterpriseKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      await program.methods
        .deletePurchase(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          purchase: purchaseAPIEnterpriseKey,
          refundee: admins.real.publicKey,
        })
        .signers([admins.real])
        .rpc();

      const purchase = await program.account.purchase.fetchNullable(
        purchaseAPIEnterpriseKey
      );
      assert.isNull(purchase);

      product = await program.account.product.fetchNullable(
        productAPIEnterpriseKey
      );
      assert.isNotNull(product);
      assert.equal(product.purchaseQty.toNumber(), preQty - 1);
      assert.equal(product.purchaseRevenue.toNumber(), preRev - 5_000_000_000);
    });
  });

  describe("Malicious approaches", () => {
    it("Alice can't delete a purchase", async () => {
      const purchaseAPIBasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productAPIBasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      //try as alice
      await program.methods
        .deletePurchase(true)
        .accountsPartial({
          authority: actors.alice.publicKey,
          purchase: purchaseAPIBasicKey,
          refundee: actors.alice.publicKey,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "InvalidAuthority");
          }
        );

      //try without admin sig
      await program.methods
        .deletePurchase(true)
        .accountsPartial({
          authority: admins.real.publicKey,
          purchase: purchaseAPIBasicKey,
          refundee: admins.real.publicKey,
        })
        .signers([actors.alice])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.isTrue(a.toString().includes("Error: unknown signer:"));
          }
        );

      const purchase =
        await program.account.purchase.fetchNullable(purchaseAPIBasicKey);
      assert.isNotNull(purchase);
    });

    it("Can't upgrade from another user's purchase", async () => {
      //bob never bought api so he does that now
      const result1 = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.bob.publicKey,
          owner: actors.bob.publicKey,
          regarding: actors.bob.publicKey,
          product: productAPIBasicKey,
          paymentFromTokenAccount: purchaserTokenAccounts.bob,
          paymentFromTokenAuthority: actors.bob.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .signers([actors.bob])
        .rpcAndKeys();

      //along comes joe and tries to get a discount by using bob's purchase receipt
      const result2 = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.joe.publicKey,
          owner: actors.joe.publicKey,
          regarding: actors.joe.publicKey,
          product: productAPIProKey,
          paymentFromTokenAccount: purchaserTokenAccounts.joe,
          paymentFromTokenAuthority: actors.joe.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          //pubkeys from alices purchase
          {
            pubkey: result1.pubkeys.product,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: result1.pubkeys.purchase,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.joe])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "PurchaseOwnerMismatch");
          }
        );
    });

    it("Can't upgrade from a purchase with a different regarding", async () => {
      const purchaseAPIBasicKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.bob.publicKey.toBuffer(),
          productAPIBasicKey.toBuffer(),
          actors.bob.publicKey.toBuffer(),
        ],
        program.programId
      )[0];

      //bob tries to upgrade but for alice's wallet as the regarding
      const result1 = await program.methods
        .purchaseProduct(1)
        .accountsPartial({
          payer: actors.bob.publicKey,
          owner: actors.bob.publicKey,
          regarding: actors.alice.publicKey, //note: alice
          product: productAPIProKey,
          paymentFromTokenAccount: purchaserTokenAccounts.bob,
          paymentFromTokenAuthority: actors.bob.publicKey,
          paymentToTokenAccount: treasuryTokenAccounts.real,
        })
        .remainingAccounts([
          //pubkeys from alices purchase
          {
            pubkey: productAPIBasicKey,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: purchaseAPIBasicKey,
            isWritable: true,
            isSigner: false,
          },
        ])
        .signers([actors.bob])
        .rpc()
        .then(
          (_) => {
            throw "should have failed";
          },
          (a) => {
            assert.equal(a.error.errorCode.code, "PurchaseRegardingMismatch");
          }
        );
    });
  });

  describe("Additional account constraint coverage", () => {
    async function expectCode(promise: Promise<unknown>, expected: string[]) {
      let caught: unknown;
      try {
        await promise;
      } catch (error) {
        caught = error;
      }
      assert.instanceOf(caught, anchor.AnchorError);
      const error = caught as anchor.AnchorError;
      assert.include(expected, error.error.errorCode.code);
    }

    function buyerAccounts(product: PublicKey) {
      return {
        payer: actors.alice.publicKey,
        owner: actors.alice.publicKey,
        regarding: actors.alice.publicKey,
        product,
        paymentFromTokenAccount: purchaserTokenAccounts.alice,
        paymentFromTokenAuthority: actors.alice.publicKey,
        paymentToTokenAccount: treasuryTokenAccounts.real,
      };
    }

    it("Rejects an unauthorized product price change without mutating the price", async () => {
      const before = await program.account.product.fetch(productSKU100);
      await expectCode(
        program.methods
          .updateProductCost(new anchor.BN(1))
          .accountsPartial({
            authority: admins.malicious.publicKey,
            product: productSKU100,
          })
          .signers([admins.malicious])
          .rpc(),
        ["InvalidAuthority"]
      );
      const after = await program.account.product.fetch(productSKU100);
      assert.equal(after.cost.toString(), before.cost.toString());
    });

    it("Rejects a token payment redirected to a different treasury owner", async () => {
      const before = await token.getAccount(
        provider.connection,
        purchaserTokenAccounts.alice
      );
      await expectCode(
        program.methods
          .purchaseProduct(1)
          .accountsPartial({
            ...buyerAccounts(productTX2022BasicKey),
            paymentToTokenAccount: treasuryTokenAccounts.malicious,
          })
          .signers([actors.alice])
          .rpc(),
        ["ConstraintTokenOwner", "ConstraintAssociated"]
      );
      const after = await token.getAccount(
        provider.connection,
        purchaserTokenAccounts.alice
      );
      assert.equal(after.amount, before.amount);
    });

    it("Rejects a purchase used as its own upgrade credit", async () => {
      const purchaseKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productTX2022BasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];
      await expectCode(
        program.methods
          .purchaseProduct(1)
          .accountsPartial(buyerAccounts(productTX2022BasicKey))
          .remainingAccounts([
            {
              pubkey: productTX2022BasicKey,
              isWritable: false,
              isSigner: false,
            },
            { pubkey: purchaseKey, isWritable: true, isSigner: false },
          ])
          .signers([actors.alice])
          .rpc(),
        ["DistinctPurchases"]
      );
    });

    it("Rejects upgrade credit from a different product group", async () => {
      const purchaseKey = PublicKey.findProgramAddressSync(
        [
          Buffer.from("purchase"),
          actors.alice.publicKey.toBuffer(),
          productTX2022BasicKey.toBuffer(),
          actors.alice.publicKey.toBuffer(),
        ],
        program.programId
      )[0];
      await expectCode(
        program.methods
          .purchaseProduct(1)
          .accountsPartial(buyerAccounts(productAPIEnterpriseKey))
          .remainingAccounts([
            {
              pubkey: productTX2022BasicKey,
              isWritable: false,
              isSigner: false,
            },
            { pubkey: purchaseKey, isWritable: true, isSigner: false },
          ])
          .signers([actors.alice])
          .rpc(),
        ["InvalidUpgradeGroup"]
      );
    });
  });

  describe("Integration tests", () => {
    it("Can get users purchases", async () => {
      const purchaseAccounts = await program.account.purchase.all([
        {
          memcmp: {
            offset: 8 + 1,
            bytes: actors.alice.publicKey.toBase58(),
          },
        },
      ]);

      const userOwnedProducts = purchaseAccounts.map(
        (pa) => pa.account.product
      );

      const products =
        await program.account.product.fetchMultiple(userOwnedProducts);

      const usersRoles: string[] = [];
      for (const p of products) {
        if (!p) {
          continue;
        }

        const product = p as anchor.IdlAccounts<StepSubscriptions>["product"];
        usersRoles.push(...product.assignedRoles6A10);
      }

      assert.includeMembers(usersRoles, ["API", "API2"]);
    });
  });
});
