'use strict';

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { manifold, utils, auth, Wallet, errors } from '../src.ts/index';
import { nodeProvider } from "./env";
import { computeAddress, sha256, toUtf8Bytes } from '../src.ts/utils';
import { sortObject } from '../src.ts/utils/misc';

let indent = "     ";
let silent = true;
let silentRpc = true;
let slowThreshold = 9000;

let providerConnection: manifold.providers.Provider;
let provider: manifold.Wallet;
let issuer: manifold.Wallet;
let middleware: manifold.Wallet;

let wallets: Array<Wallet> = [];
let kycList: Array<auth.KycData> = [];
let kycTransactions: Array<auth.KycTransaction> = [];
let kycAddresses: string[] = [];

let defaultOverrides = {
    logSignaturePayload: function (payload) {
        if (!silentRpc) console.log(indent, "signaturePayload:", JSON.stringify(payload));
    },
    logSignedTransaction: function (signedTransaction) {
        if (!silentRpc) console.log(indent, "signedTransaction:", signedTransaction);
    }
}

if ("" != nodeProvider.kyc.middleware) {
    describe('Suite: KYC', function () {
        this.slow(slowThreshold); // define the threshold for slow indicator

        if (silent) { silent = nodeProvider.trace.silent; }
        if (silentRpc) { silentRpc = nodeProvider.trace.silentRpc; }

        it("Initialize", async function () {
            providerConnection = new manifold.providers.JsonRpcProvider(nodeProvider.connection, nodeProvider)
                .on("rpc", function (args) {
                    if (!silentRpc) {
                        if ("response" == args.action) {
                            console.log(indent, "RPC REQ:", JSON.stringify(args.request));
                            console.log(indent, "    RES:", JSON.stringify(args.response));
                        }
                    }
                }).on("responseLog", function (args) {
                    if (!silentRpc) {
                        console.log(indent, "RES LOG:", JSON.stringify({ info: args.info, response: args.response }));
                    }
                });

            // manifold1qrxglea6m8rzzadj60jwaesfdpks9p6uzyv8xw
            provider = manifold.Wallet.fromMnemonic(nodeProvider.kyc.provider).connect(providerConnection);
            expect(provider).to.exist;
            if (!silent) console.log(indent, "Provider:", await provider.encrypt("any strong password"));

            // manifold1ngx32epz5v5gyunepkarfh4lt0g6mqr79aq3ex
            issuer = manifold.Wallet.fromMnemonic(nodeProvider.kyc.issuer);
            expect(issuer).to.exist;
            if (!silent) console.log(indent, "Issuer:", await issuer.encrypt("any strong password"));

            // manifold1mklypleqjhemrlt6z625rzqa0jl6namdmmqnx4
            middleware = manifold.Wallet.fromMnemonic(nodeProvider.kyc.middleware).connect(providerConnection);
            expect(middleware).to.exist;
            if (!silent) console.log(indent, "Middleware:", await middleware.encrypt("any strong password"));

            if (!silent) console.log("");
            // Predefined wallet
            // wallets.push(manifold.Wallet.fromMnemonic("").connect(
            //     new manifold.providers.JsonRpcProvider(nodeProvider.connection, nodeProvider)
            // ));
            //
            // wallets.push((
            //     await manifold.Wallet.fromEncryptedJson(
            //         '{"address":"manifold17t4thhuz2a9gv86znwlw5hxh6t8c65xq9au3lm","id":"d0351c0f-cfc2-496a-af51-43ce51666c06","version":3,"Crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"bcd5e43841bf90ce9a2d22fb65a9a25b"},"ciphertext":"02cdada239028991470142eeaa83b12a6dc88c6d269ce8b43b1d788e96cdfc95","kdf":"scrypt","kdfparams":{"salt":"fb95a9b853431088fdc55f6f6efc194fbac4cb2cce5ab64bcb71e00c490c3756","n":131072,"dklen":32,"p":1,"r":8},"mac":"054cd4b7867ab895860acf4e3eeb90da39252b9c6d98ba9bb46e65aff67b84dd"},"x-manifold":{"client":"manifold-sdk","filename":"UTC--2019-06-28T06-13-18.0Z--manifold17t4thhuz2a9gv86znwlw5hxh6t8c65xq9au3lm","mnemonicCounter":"4ba5323aad17ae778df958805993f019","mnemonicCiphertext":"4781ba84692da0c78d99dd6151c7aa9c","version":"0.1"}}',
            //         "any strong password"
            //     )).connect(providerConnection)
            // );

            let walletCount = 1;
            for (let i = 0; i < walletCount; i++) {
                let wallet = manifold.Wallet.createRandom().connect(providerConnection);
                wallets.push(wallet);
                if (!silent) console.log(indent, "Wallet:", wallet.address, "-", wallet.mnemonic);
            }
        });

        it("Sign kyc address", function () {
            let promises = [];

            for (let wallet of wallets) {
                promises.push(auth.Kyc.create(wallet).then((kyc) => {
                    let seed = sha256(toUtf8Bytes(JSON.stringify(sortObject({
                        juridical: ["", ""].sort(),
                        seed: utils.getHash(utils.randomBytes(32))
                    }))));

                    let kycAddress = kyc.getKycAddress({
                        country: "MY",
                        idType: "NIC",
                        id: wallet.address,
                        idExpiry: 20200101,
                        dob: 19800101,
                        seed
                    });

                    return kyc.sign(kycAddress).then((data) => {
                        expect(data).to.exist;
                        kycList.push(data);
                        kycAddresses.push(kycAddress);
                        if (!silent) console.log(indent, "KYC data:", JSON.stringify(data));
                    });
                }));
            }
            return Promise.all(promises).then(() => {
                expect(kycList.length).to.equal(wallets.length);
            });
        });

        it("Provider sign kyc data", function () {
            return auth.Kyc.create(provider).then(async (kyc) => {
                for (let kycData of kycList) {
                    let kycTransaction = {
                        payload: kycData,
                        signatures: []
                    }
                    let tx = await kyc.signTransaction(kycTransaction);
                    expect(tx.signatures.length).to.equal(1);
                    kycTransactions.push(tx);
                }
                expect(kycTransactions.length).to.be.equal(wallets.length);

                for (let kycTransaction of kycTransactions) {
                    expect(kycTransaction.signatures.length).to.equal(1);
                }
            });
        });

        it("Issuer sign kyc data", function () {
            return auth.Kyc.create(issuer).then(async (kyc) => {
                for (const [index, kycTransaction] of kycTransactions.entries()) {
                    kycTransactions[index] = await kyc.signTransaction(kycTransaction);
                }
                for (let kycTransaction of kycTransactions) {
                    expect(kycTransaction.signatures.length).to.equal(2);
                }
            });
        });

        it("Verify kyc transaction", function () {
            this.slow(slowThreshold); // define the threshold for slow indicator

            for (let kycTransaction of kycTransactions) {
                if (!silent) console.log(indent, "Kyc transaction:", JSON.stringify(kycTransaction));
                let result = manifold.utils.verify(JSON.stringify(kycTransaction.payload.kyc), kycTransaction.payload.signature, kycTransaction.payload.kyc.from);
                expect(true).to.equal(result);

                for (let signature of kycTransaction.signatures) {
                    let address = computeAddress(signature.pub_key.value);
                    let valid = manifold.utils.verify(JSON.stringify(kycTransaction.payload), signature.signature, address);
                    if (!valid) {
                        if (!silent) console.log(indent, "Issuer invalid signature:", JSON.stringify(signature));
                    }
                    expect(valid).to.equal(true);
                }
            }
        });

        it("Whitelist", function () {
            return auth.Kyc.create(middleware).then(async (kyc) => {
                for (let kycTransaction of kycTransactions) {
                    let overrides = {
                        logSignaturePayload: defaultOverrides.logSignaturePayload,
                        logSignedTransaction: defaultOverrides.logSignedTransaction
                    };
                    let receipt = await kyc.whitelist(kycTransaction, overrides);
                    expect(receipt).to.exist;
                    if (!silent) console.log(indent, "Whitelist.receipt:", JSON.stringify(receipt));
                    expect(receipt.status).to.equal(1);
                }
            });
        });

        it("Whitelist - checkDuplication", function () {
            return auth.Kyc.create(middleware).then(async (kyc) => {
                for (let kycTransaction of kycTransactions) {
                    let overrides = {
                        logSignaturePayload: defaultOverrides.logSignaturePayload,
                        logSignedTransaction: defaultOverrides.logSignedTransaction
                    };
                    try {
                        let receipt = await kyc.whitelist(kycTransaction, overrides);
                        expect(receipt).to.exist;
                        expect(receipt.status).to.equal(0);
                    }
                    catch (error) {
                        expect(error.code).to.equal(errors.EXISTS);
                    }
                }
            });
        });

        it("Whitelist - checkDuplication with manual broadcast", function () {
            return auth.Kyc.create(middleware).then(async (kyc) => {
                for (let kycTransaction of kycTransactions) {
                    let overrides = {
                        logSignaturePayload: defaultOverrides.logSignaturePayload,
                        logSignedTransaction: defaultOverrides.logSignedTransaction
                    };
                    try {
                        let request = await kyc.getWhitelistTransactionRequest(kycTransaction, overrides);
                        let signedTransaction = await middleware.sign(request, overrides);
                        let response = await providerConnection.sendTransaction(signedTransaction, overrides);
                        let receipt = await providerConnection.waitForTransaction(response.hash);

                        expect(receipt).to.exist;
                        expect(receipt.status).to.equal(0);
                    }
                    catch (error) {
                        expect(error.code).to.equal(errors.EXISTS);
                    }
                }
            });
        });

        it("Check whitelist status", async function () {
            for (let wallet of wallets) {
                let whitelisted = await wallet.isWhitelisted();
                expect(whitelisted).to.equal(true);
            }
        });

        it("Check KYC address", async function () {
            let index = 0;
            for (let wallet of wallets) {
                let kycAddress = await wallet.provider.getKycAddress(wallet.address);
                if (!silent) console.log(indent, "Address:", wallet.address, "-", kycAddress);
                expect(kycAddress).to.equal(kycAddresses[index++]);
            }
        });

        it("KYC bind wallets relationship", async function () {
            for (let wallet of wallets) {
                let kycAddress = await wallet.provider.getKycAddress(wallet.address);
                let receipt = await auth.Kyc.bind(wallet.address, kycAddress, middleware);
                expect(receipt).to.exist;
                if (!silent) console.log(indent, "kycBind.receipt:", JSON.stringify(receipt));
                expect(receipt.status).to.equal(1);
            }
        });

        it("KYC unbind wallets relationship", async function () {
            for (let wallet of wallets) {
                let kycAddress = await wallet.provider.getKycAddress(wallet.address);
                let receipt = await auth.Kyc.unbind(wallet.address, kycAddress, middleware);
                expect(receipt).to.exist;
                if (!silent) console.log(indent, "kycUnbind.receipt:", JSON.stringify(receipt));
                expect(receipt.status).to.equal(1);
            }
        });

        it("Revocation", async function () {
            for (let wallet of wallets) {
                await auth.Kyc.revoke(wallet.address, provider).then((transaction) => {
                    expect(transaction).to.exist;
                    if (!silent) console.log(indent, "Provider signed revoke transaction:", JSON.stringify(transaction));
                    return auth.Kyc.signRevokeTransaction(transaction, issuer);
                }).then((transaction) => {
                    expect(transaction).to.exist;
                    if (!silent) console.log(indent, "Issuer signed revoke transaction:", JSON.stringify(transaction));
                    return auth.Kyc.sendRevokeTransaction(transaction, middleware, defaultOverrides);
                }).then((receipt) => {
                    expect(receipt).to.exist;
                    if (!silent) console.log(indent, "Revoke RECEIPT:", JSON.stringify(receipt));
                    expect(receipt.status).to.equal(1);
                });
            }
        });

        it("Check revoke status", async function () {
            for (let wallet of wallets) {
                let whitelisted = await wallet.isWhitelisted();
                expect(whitelisted).to.equal(false);
            }
        });

        it("Clean up", function () {
            providerConnection.removeAllListeners();
        });
    });
}
