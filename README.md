# Step Subscriptions

A Solana program for selling prepaid subscriptions and permanent products with SPL tokens.

Step Subscriptions gives applications an on-chain product catalogue, payment collection and purchase records. Administrators configure plans and a treasury; customers buy access, extend subscriptions and apply eligible payments toward related products. Applications read those records to grant features such as API access, dashboard tools, memberships or downloadable reports.

Subscriptions renew through additional purchase transactions. Product roles are metadata that the consuming application uses to enforce access.

## Features

- **Timed and permanent products.** Sell fixed-duration access or purchases with no expiration.
- **Token payments.** Price each product in an SPL token and collect payment directly into the configured treasury's associated token account.
- **Quantity limits.** Cap permanent ownership or the amount of subscription time a purchase can accumulate.
- **Volume discounts.** Apply a basis-point discount when the requested quantity reaches a configured threshold.
- **Product upgrades.** Credit eligible purchases in the same upgrade group and payment mint, including integer proration of unused subscription time.
- **Flexible purchase identities.** Separate the rent payer, purchase owner, payment authority and the account the purchase concerns.
- **Product metadata.** Store names, descriptions, families, roles and custom fields for application integrations.
- **Durable accounting.** Keep lifetime cash, quantity and permanent-credit counters alongside a bounded ten-receipt history.
- **Administration and events.** Manage products through two authority slots and emit a `PurchaseEvent` for successful purchases.

## How it works

| Account | Purpose |
| --- | --- |
| `GlobalState` | Stores the treasury wallet and two administrator public keys. Either administrator can perform administrative operations; the slots do not form a multisignature threshold. |
| `Product` | Stores a unique code, price, payment mint, optional duration, ownership limit, upgrade group, discounts and application metadata. New products start inactive. |
| `Purchase` | Connects an owner, product and `regarding` account. Stores expiry, recent receipts and versioned lifetime accounting. |

Accounts use program-derived addresses (PDAs):

```text
global state: ["global_state"]
product:      ["product", trimmed product code]
purchase:     ["purchase", owner, product, regarding]
```

`regarding` identifies the subject of the purchase. For personal access it can equal the owner's wallet. It can also identify another account, such as a team or project, according to the application's rules. The program requires the owner's signature; `regarding` itself is an unchecked reference and does not require consent or a signature.

### Time, quantity and pricing

For a timed product, each unit adds `purchase_duration_secs` seconds. A renewal extends an active purchase from its existing expiry; an expired purchase restarts from the current on-chain time. The maximum remaining duration is `purchase_duration_secs × max_owned`.

For a permanent product, expiry is `i64::MAX` and `max_owned` caps the accumulated quantity for that owner/product/subject combination.

Prices use the payment mint's smallest units. For example, ten tokens of a six-decimal mint cost `10_000_000` units. Discount basis points range from `0` to `10_000`, with `1_000` representing 10%.

Payment is calculated in this order:

```text
gross payment = unit price × requested quantity
net payment   = gross payment − eligible upgrade credit
discount      = floor(net payment × discount_bps / 10_000)
amount paid   = net payment − discount
```

The discount applies only when the requested quantity meets `qty_for_discount`. Quantities must be positive. Credit above the gross payment is rejected as an unsupported downgrade.

### Upgrade credits

An upgrade supplies previous products and their purchase accounts in ordered pairs. Each source must match the buyer's owner and `regarding` accounts, the destination's non-null upgrade group and its payment mint. Each source purchase must be distinct, writable and different from the destination purchase.

- **Timed sources:** eligible unused time produces prorated credit, rounded down to whole token base units. Credited history cannot be consumed twice. Timed credits are calculated from the retained receipt history.
- **Permanent sources:** the destination tracks the cumulative cash pool already credited to it. Reusing the same pool adds no credit; newly paid source cash can increase it. Supply the cumulative set of source purchases when adding more permanent credit to a destination.

For example, using the same token mint:

| Purchase | Product price | Credit applied | New cash payment |
| --- | ---: | ---: | ---: |
| Basic | 10 | 0 | 10 |
| Pro, using Basic | 20 | 10 | 10 |
| Enterprise, using Basic and Pro | 50 | 20 | 30 |

The Enterprise pool contains the actual cash paid for Basic and Pro. A second Pro purchase cannot reuse Basic's credit. Upgrades reduce a new payment; they do not transfer a token refund to the buyer.

## Build and run locally

### Requirements

| Tool | Project version |
| --- | --- |
| Anchor CLI, Rust crates and TypeScript client | `1.2.2` |
| Agave/Solana CLI and `solana-test-validator` | `4.4.0` |
| SBF platform tools / architecture | `v1.57` / `v3` |
| Node.js | `22.12.0` or newer |
| Rust and npm | A working host Rust toolchain and npm installation |

Use the CLI versions pinned in [Anchor.toml](Anchor.toml), available from the official [Anchor release](https://github.com/otter-sec/anchor/releases/tag/v1.2.2) and [Agave release](https://github.com/anza-xyz/agave/releases/tag/v4.4.0). Put the matching executables on `PATH`. The local runner also uses Bash and `curl`.

From the repository root:

```sh
npm ci --ignore-scripts
npm run build
npm test
```

The build generates the SBF program, IDL and TypeScript types under `target/`. It uses `--ignore-keys` because the historical deployed program's private key is not included.

`npm test` runs Rust unit tests, then integration and security regression suites against separate fresh local validators. The runner loads the program at genesis, creates temporary wallets and ledgers, and removes them when it exits. It supplies `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` itself, so the automated tests need no existing Solana wallet or funded public-network account. The full suite takes several minutes, including expiry tests.

The default RPC port is `18899`; that port and the following two ports must be free. To select another range or reuse an existing build:

```sh
TEST_RPC_PORT=19899 npm test
SKIP_BUILD=1 npm test
```

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the program, IDL and generated client types. |
| `npm run test:unit` | Run Rust unit tests. |
| `npm run test:integration` | Build and run the main local-validator suite. |
| `npm run test:security` | Build and run focused local-validator regressions. |
| `npm run typecheck` | Check TypeScript after generating the client types. |
| `npm run lint` | Check TypeScript formatting. |

The test runner is [scripts/test-local.sh](scripts/test-local.sh). The files in `migrations/` are historical operator helpers and are not executed by this runner.

## Use the TypeScript client

The following examples run from the repository root after a build. They assume a running deployment, a funded provider wallet and matching environment variables. The automated test validators stop when `npm test` finishes; they are not persistent environments for these examples.

```sh
export ANCHOR_PROVIDER_URL=http://127.0.0.1:18899
export ANCHOR_WALLET=/path/to/your/development-wallet.json
```

### Connect

```ts
import { readFileSync } from "node:fs";
import * as anchor from "@anchor-lang/core";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import type { StepSubscriptions } from "./target/types/step_subscriptions";

const provider = anchor.AnchorProvider.env();
const idl = JSON.parse(
  readFileSync("target/idl/step_subscriptions.json", "utf8")
) as StepSubscriptions;
const program = new anchor.Program<StepSubscriptions>(idl, provider);
```

For an application outside this workspace, use the generated IDL and types for its own deployed program identity.

### Initialize the program

Initialization runs once. The provider below must be the deployed program's upgrade authority. It chooses the operational administrator and treasury; these can be different wallets in an application.

```ts
async function initializeProgram() {
  const [programData] = anchor.web3.PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    new anchor.web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
  );

  return program.methods
    .initializeProgram(provider.wallet.publicKey, provider.wallet.publicKey)
    .accountsPartial({
      payer: provider.wallet.publicKey,
      upgradeAuthority: provider.wallet.publicKey,
      program: program.programId,
      programData,
    })
    .rpc();
}
```

### Create and activate a plan

This example prices 30 days of access at ten tokens of a six-decimal mint. Its ownership limit permits up to twelve periods of remaining time. The provider must be an administrator.

```ts
async function createApiPlan(paymentMint: anchor.web3.PublicKey) {
  const code = "api-30d";
  const [product] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("product"), Buffer.from(code)],
    program.programId
  );

  await program.methods
    .createProduct(
      code,
      "30 Day API Access",
      "Prepaid access to the API",
      "api",
      "api-access",
      paymentMint,
      new anchor.BN(10_000_000),
      new anchor.BN(30 * 24 * 60 * 60),
      12,
      ["api"]
    )
    .accountsPartial({
      payer: provider.wallet.publicKey,
      authority: provider.wallet.publicKey,
      product,
    })
    .rpc();

  await program.methods
    .updateProductActiveState(true)
    .accountsPartial({ authority: provider.wallet.publicKey, product })
    .rpc();

  return product;
}
```

Use `null` for the duration when creating a permanent product, or for the upgrade group when the product has no upgrade path. Code, duration, maximum ownership and upgrade group are fixed at creation. Price, activation, discounts and supported metadata have update instructions.

### Purchase a period

Create and fund the buyer's associated token account and create the treasury's associated token account before purchasing. Pass a provider connected to the customer's wallet; that wallet is the owner, rent payer and token payment authority in this example. `treasuryOwner` must match the wallet stored in `GlobalState`.

```ts
async function buyOnePeriod(
  buyerProvider: anchor.AnchorProvider,
  product: anchor.web3.PublicKey,
  paymentMint: anchor.web3.PublicKey,
  treasuryOwner: anchor.web3.PublicKey
) {
  const buyerProgram = new anchor.Program<StepSubscriptions>(idl, buyerProvider);
  const owner = buyerProvider.wallet.publicKey;
  const paymentFromTokenAccount = await getAssociatedTokenAddress(
    paymentMint,
    owner
  );
  const paymentToTokenAccount = await getAssociatedTokenAddress(
    paymentMint,
    treasuryOwner,
    true
  );

  return buyerProgram.methods
    .purchaseProduct(1)
    .accountsPartial({
      payer: owner,
      owner,
      regarding: owner,
      product,
      paymentFromTokenAccount,
      paymentFromTokenAuthority: owner,
      paymentToTokenAccount,
    })
    .rpc();
}
```

To claim upgrade credit, append `.remainingAccounts(...)` before `.rpc()`, passing each source product followed by its purchase account. Product accounts can be read-only; purchase accounts must be writable. See the executable examples in [tests/step-subscriptions.ts](tests/step-subscriptions.ts) and [tests/security-regressions.ts](tests/security-regressions.ts).

## Instruction reference

Names below use the generated TypeScript client. Rust handlers are in [lib.rs](programs/step-subscriptions/src/lib.rs).

| Instruction | Caller | Function |
| --- | --- | --- |
| `initializeProgram` | Program upgrade authority, with a rent payer | Set the initial administrator and treasury. |
| `updateStateAuthority` | Administrator | Set or clear authority slot `0` or `1`; replacing the caller's own slot requires `allowRemoveSelf`. |
| `updateStatePaymentWallet` | Administrator | Change the treasury for future payments. |
| `createProduct` | Administrator, with a rent payer | Create an initially inactive product. |
| `updateProductActiveState` | Administrator | Enable or disable purchases and renewals. |
| `updateProductCost`, `updateProductDiscount` | Administrator | Change pricing or the discount threshold/rate. |
| `updateProductMint` | Administrator | Change the mint before any purchase; same-mint updates remain allowed afterward. |
| `updateProductName`, `updateProductBlurb`, `updateProductFamily`, `updateProductAssignedRoles` | Administrator | Update application-facing metadata. |
| `updateProductI64A5`, `updateProductStr` | Administrator | Update custom numeric or string fields. |
| `purchaseProduct` | Signing owner, rent payer and payment authority | Pay for a purchase or renewal and optionally apply upgrade credit. One wallet can perform all three roles. |
| `deletePurchase` | Administrator | Close any purchase and send its rent to `refundee`; optionally reverse its recorded sales totals. This does not refund token payments. |

## Integration and compatibility notes

- **Access enforcement belongs to the application.** Check purchase ownership, `regarding`, expiry and quantity when granting access. A receipt's existence or its product's role list alone is insufficient. Product deactivation prevents purchases and renewals; the application defines how existing access responds to metadata changes and upgrades.
- **Token support.** Payment accounts use the original SPL Token program. Token-2022 mints require additional integration work.
- **History is bounded.** `history_10` holds the latest ten receipts. Versioned lifetime quantities, actual cash and permanent-credit counters occupy reserved account bytes; [state.rs](programs/step-subscriptions/src/state.rs) defines their interpretation.
- **Payment mints become fixed.** After a purchase, the product's mint stays locked even if an administrator deletes receipts or reverses accounting. This keeps historical upgrade credit in one denomination.
- **Older accounts may need migration.** Ambiguous ownership, payment totals or prior permanent credits return `PurchaseMigrationRequired` rather than reconstructing lost history. Some legacy cash-only renewals remain possible. No historical-state migration is included.
- **Use your own deployment identity.** The checked-in program ID is retained for reference and local testing. Adapt the program ID, configuration and clients for an independently controlled deployment; review historical state before upgrading an existing installation.

The implementation is provided for reference and adaptation. Run the local checks and review dependencies and deployment assumptions for your application. CI and GitHub Actions are not configured in this repository.

## License

Original Step Finance contributions are licensed under [MIT](LICENSE). Dependency licenses and existing attribution remain applicable; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
