const ROLE_TOKEN_CREATOR = 0x00040000;
const ROLE_COUPON_MANAGER = 0x00000100;

const Gem = artifacts.require("./GemERC721");
const Sale = artifacts.require("./CouponSale");
const Sale2 = artifacts.require("./Presale2");
const AddressUtils = artifacts.require("./AddressUtils");
const StringUtils = artifacts.require("./StringUtils");

module.exports = async function(deployer, network, accounts) {
	if(network === "test") {
		console.log("[deploy gem] test network - skipping the migration script");
		return;
	}
	if(network === "coverage") {
		console.log("[deploy gem] coverage network - skipping the migration script");
		return;
	}

	// where the funds go to: chestVault - 19.05%, beneficiary - 80.95%
	let chestVault = "0xc352f692f55def49f0b736ec1f7ca0f862eabd23"; // MainNet Chest Wallet
	let beneficiary = "0xe0123204873fd29a29aef3f99faf1b1c45fe3b1e"; // MainNet MultiSig

	// for test network we redefine MultiSig addresses accordingly
	if(network === "development") {
		// beneficiary = "0xb4e8e4f7e6024b37ed2584e8c86b2917dae9a2da"; // Rinkeby MultiSig
		// chestVault = "0xaF8413e5785d63694cF562Cf2dDA9B59Ff00E0FD"; // Rinkeby Chest Wallet
		beneficiary = "0xEd6003e7A6494Db4ABabEB7bDf994A3951ac6e69";
		chestVault = "0xEd6003e7A6494Db4ABabEB7bDf994A3951ac6e69";
	}

	// token and presale address already exist, presale 2 is new to deploy
	let tokenAddress = "0xeae9d154da7a1cd05076db1b83233f3213a95e4f"; // MainNet token address
	let saleAddress = "0xa207d2496688134f538a307b25e174b267ba6765"; // MainNet Presale address
	let sale2Address = "";

	let gem = Gem.at(tokenAddress);
	let sale = Sale.at(saleAddress);
	// sale2 is defined below

	// for test network we redeploy first Presale
	if(network === "development") {
		tokenAddress = "0xd78ea452d277060af6283ca7065b5f5330a62a7a";
		gem = Gem.at(tokenAddress);

		saleAddress = "0xaab2cc311e640344238acd666cca3f8558329fde";
		sale = Sale.at(saleAddress);
	}

	// deploy sale 2
	await deployer.deploy(Sale2, saleAddress, chestVault, beneficiary);
	const sale2 = await Sale2.deployed();
	sale2Address = sale2.address;

	// grant new sale a permission to mint gems
	await gem.addOperator(sale2Address, ROLE_TOKEN_CREATOR);

	// grant permissions to create coupons
	await sale2.addOperator("0x501E13C2aE8D9232B88F63E87DFA1dF28103aCb6", ROLE_COUPON_MANAGER); // John

	console.log("______________________________________________________");
	console.log("gem:        " + tokenAddress);
	console.log("sale:       " + saleAddress);
	console.log("sale2       " + sale2Address);
	console.log("______________________________________________________");
	console.log("gems:       " + await gem.balanceOf(accounts[0]));
	console.log("geodes:     " + await sale.geodeBalances(accounts[0]));
	console.log("geodes(2):  " + await sale2.geodeBalances(accounts[0]));

};
