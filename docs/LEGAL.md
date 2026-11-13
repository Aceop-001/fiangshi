# Legal

Version 2026-11-10. This page covers any running copy of Fiangshi: its pages and its API. The person or team running a copy is "the operator". The software is open source under the MIT licence.

## In short

- Fiangshi gives an automated opinion about a payment counterparty. It is not advice, and it can be wrong in both directions.
- You decide whether to pay. Nothing Fiangshi returns is an instruction, a guarantee or an endorsement.
- Fiangshi never holds funds or keys, and never signs or sends a transaction.
- A verdict about a seller is not an accusation. It is the output of published rules applied to public data.
- There are no accounts, scripts or analytics. There is one functional cookie, and it only remembers that you closed the first-visit tour.

## Terms of use

### 1. What Fiangshi is

Fiangshi requests a paid endpoint without paying it, reads the payment terms, looks up public on-chain facts about the wallet that would be paid, and returns ALLOW, REVIEW or BLOCK with the evidence it used and a receipt. The rules it applies are published with the code and summarised in the [guide](GUIDE.md).

### 2. Advisory only

A verdict is information to help you decide. It is not financial, legal, investment or security advice. ALLOW does not mean a seller is honest, solvent or will deliver what it sells. REVIEW and BLOCK do not mean a seller has done anything wrong. For anything that matters to you, check by other means before you pay.

### 3. Your decisions are yours

You, or the agent you run, decide whether to pay an endpoint and how much. The operator is not a party to any payment between you and a seller and cannot stop or reverse one.

### 4. No custody

Fiangshi does not hold funds, private keys or credentials. It does not sign or send transactions, for you or for anyone else.

### 5. Paid routes

Some API routes quote a price in a 402 response, using the x402 protocol. In this build settlement is a dry run: the payment header is checked for structure, and nothing is charged or settled. If an operator turns on real settlement, the price of a route is the amount quoted in its 402 response at the time of the request.

### 6. Fair use

Do not use Fiangshi to harass a seller, to present a verdict as proof of wrongdoing, or to overload this service or the endpoints it probes. Each check sends one unpaid request to the endpoint you name, so only submit endpoints you would be entitled to request yourself.

### 7. No warranty

Fiangshi is provided as is, without warranty of any kind. Its data can be incomplete, late or wrong. Its rules can misfire. It can be unavailable. To the extent the law allows, the operator and the authors are not liable for any loss that comes from using Fiangshi or from relying on a verdict. This matches the MIT licence that covers the code.

### 8. Changes

The rules and these terms can change. Each receipt records the verdict and the evidence at the time it was issued. A later change to the rules does not rewrite an earlier receipt.

## Verdicts about sellers

### How a verdict is produced

Verdicts are automatic. No person reviews them. They come from three things: the payment terms the endpoint itself returns, public data about the payee wallet on the Base blockchain, and the name the seller gives in the public x402 Bazaar catalog. A fixed set of rules, described in the [guide](GUIDE.md), turns those into a band.

### What a verdict does not say

- **BLOCK for a shared funder (kinship)** means the wallet's first funder also first funded three or more other listed sellers, and that funder is not a known exchange or relayer. It does not mean the sellers are colluding. An unlabelled funder can be an exchange or a payment service.
- **REVIEW for missing data (silence)** means a signal Fiangshi needs was not available. It says nothing about the seller.
- **A low score** reflects a young or quiet wallet inside a 90-day window. New and small sellers score low without having done anything wrong.
- **BLOCK for a null payee** is the one verdict about the endpoint itself, not about a person: its payment address is one that nobody can spend from.

### Names and people

Fiangshi compares the name in a listing with the listing's own URL and with public wallet labels. It does not try to work out who is behind a wallet. A label that names a private person is never shown on these pages and never counts against a seller.

### Corrections

If you run a listed endpoint and think its verdict is wrong, write to the operator contact at the end of this page. Include the payee address and the receipt id. The most useful evidence is usually who the wallet's first funder is.

A sealed receipt cannot be edited: that is what makes receipts verifiable. A correction is made by fixing the data or the rule, and it takes effect in the next census and in every receipt issued after it.

## Privacy

### What Fiangshi receives

- The endpoint URL you ask it to check.
- On paid routes, an `X-PAYMENT` header. It contains the wallet address the payment would come from.

### What Fiangshi stores

- One receipt per check: the URL checked, the payee wallet, the price asked, a hash of the payment terms, the verdict, the quoted evidence and the time. Receipts are kept in an append-only ledger. Anyone who has a receipt id can read that receipt.
- Cached model replies about a payee, so the same question is not paid for twice.

The software does not store the paying wallet address, your IP address or any identifier for you, and it keeps no request log. The company that hosts a given copy may keep its own server logs.

The pages use no local storage, run no scripts and load nothing from other sites.

### The one cookie

When you close or finish the first-visit tour, the site sets one cookie so the tour does not open again:

| name | value | lifetime | purpose |
|---|---|---|---|
| `fiangshi_tour` | `done` | one year | remembers that the tour was closed |

It is strictly functional. It holds no identifier, it is the same for every visitor, it is never read for anything else, and it is never sent to anyone but this site (`HttpOnly`, `SameSite=Lax`). If you delete it, the tour opens again on your next visit. The cookie is set only at the moment you close the tour.

### Who else receives data when a check runs

- **The endpoint being checked** receives one unpaid request from this copy of Fiangshi. It sees this server's address, not yours.
- **SERV (OpenServ)** receives the endpoint URL, its payment terms and the public on-chain facts about the payee, and returns advice.
- **Dolphin** receives only the seller's public listing name. It never receives the URL or a wallet address.
- **Surf** supplies on-chain data when a census is built. It is not called when you run a check.

None of them receives anything about you.

### Public data about sellers

Wallet addresses, endpoint URLs and listing names come from the public x402 Bazaar catalog and the Base blockchain. Fiangshi publishes what its rules conclude from them.

To raise a privacy concern, write to the operator contact at the end of this page.

## Licence and third parties

- **Code.** MIT licence. See the `LICENSE` file in the repository.
- **Data and services.** Fiangshi uses the x402 Bazaar catalog for endpoint listings, Surf for on-chain data and wallet labels, SERV by OpenServ for model advice, and Dolphin for reading listing names. It is independent of all of them: not affiliated with, sponsored by or endorsed by any. Their names belong to their owners.
- **Name and logo.** The Fiangshi name and logo belong to the project's author.

## Contact

A running copy of Fiangshi shows its operator contact at the end of this page, set with `FIANGSHI_CONTACT`. For the open-source project itself, use the project repository.
