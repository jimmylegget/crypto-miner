/**
 * Extend String prototype by adding pad function
 * @param size new String length, will be padded with zeros
 * @return {String} zero padded string
 */
String.prototype.pad = function(size) {
	let s = this;
	while(s.length < (size || 2)) {
		s = "0" + s;
	}
	return s;
};

/**
 * Extend Array prototype by adding pack function.
 * Only array of strings is currently supported.
 * @param size used to pad each element in the array before joining
 * @return {String} packed string containing entire array
 */
Array.prototype.pack = function(size) {
	let copy = new Array(this.length);
	for(let i = 0; i < this.length; i++) {
		copy[i] = this[i].toString(16).pad(size);
	}
	return copy.join("");
};


/**
 * Presale API instance provides a convenient way ot access deployed
 * smart contract(s) functionality, including reading data, writing data
 * (transactions) and listening to specific event
 * @constructor
 * @param logger [optional] additional to `console` logger to use
 * @param jQuery_instance [optional] jQuery v3+ instance to use
 */
function PresaleApi(logger, jQuery_instance) {
	const ERR_NO_WEB3 = 0x1;
	const ERR_WEB3_LOCKED = 0x2;
	const ERR_WEB3_ETH_ERROR = 0x4;
	const ERR_AJAX_LOAD_ABI = 0x8;
	const ERR_CONTRACT_VERSION_MISMATCH = 0x10;
	const ERR_WRONG_ABI = 0x20;
	const ERR_WEB3_ERROR = 0x40;
	const ERR_NOT_INITIALIZED = 0x80;
	const ERR_NO_CALLBACK = 0x100;
	const ERR_WRONG_INPUT = 0x200;

	// ---------- START SECTION 1: Constants and Variables ----------
	// version constants define smart contracts compatible with this API
	const TOKEN_VERSION = 0x3;
	const PRESALE_VERSION = 0x4;

	// jQuery instance to use
	const jQuery3 = jQuery_instance || jQuery || $;

	// API state variables, depend on current connected network, default account, etc
	let myWeb3;
	let myAccount;
	let myNetwork;
	let tokenInstance;
	let presaleInstance;
	// ---------- END SECTION 1: Constants and Variables ----------


	// ---------- START SECTION 2: Auxiliary private functions ----------
	// logs an error into console, triggers logger's error callback if provided
	function logError(...msg) {
		console.error(msg.join(""));
		if(logger && logger.error) {
			try {
				logger.error(...msg);
			}
			catch(e) {
				console.error("external logger call [error] failed: " + e);
			}
		}
	}

	// logs a warning into console, triggers logger's warning callback if provided
	function logWarning(...msg) {
		console.warn(msg.join(""));
		if(logger && logger.warning) {
			try {
				logger.warning(...msg);
			}
			catch(e) {
				console.error("external logger call [warning] failed: " + e);
			}
		}
	}

	// logs a message into console, triggers logger's info callback if provided
	function logInfo(...msg) {
		console.log(msg.join(""));
		if(logger && logger.info) {
			try {
				logger.info(...msg);
			}
			catch(e) {
				console.error("external logger call [info] failed: " + e);
			}
		}
	}

	// logs a message into console, triggers logger's trace callback if provided
	function logTrace(...msg) {
		console.log(msg.join(""));
		if(logger && logger.trace) {
			try {
				logger.trace(...msg);
			}
			catch(e) {
				console.error("external logger call [info] failed: " + e);
			}
		}
	}

	// logs a message into console, triggers logger's success callback if provided
	function logSuccess(...msg) {
		console.log(msg.join(""));
		if(logger && logger.success) {
			try {
				logger.success(...msg);
			}
			catch(e) {
				console.error("external logger call [success] failed: " + e);
			}
		}
	}

	// call callback function safely in a try..catch block
	function tryCallback(callback, errCode, result) {
		try {
			callback(errCode, result);
		}
		catch(e) {
			logWarning("couldn't execute callback: ", e);
		}
	}

	// call callback function safely in a try..catch block
	// if callback is undefined or not a function - do nothing
	function tryCallbackIfProvided(callback, errCode, result) {
		if(callback && {}.toString.call(callback) === '[object Function]') {
			tryCallback(callback, errCode, result);
		}
	}

	// Translates network ID into human-readable network name
	function networkName(network) {
		switch(network) {
			case "0": return "0: Olympic";
			case "1": return "1: Frontier";
			case "2": return "2: Morden";
			case "3": return "3: Ropsten";
			case "4": return "4: Rinkeby";
			case "42": return "42: Kovan";
			case "77": return "77: Sokol";
			case "99": return "99: POA";
			case "7762959": return "7762959: Musicoin";
			default: return network + ": Unknown network";
		}
	}

	// Called once tokenInstance or presaleInstance initialized,
	// used to execute the callback properly only after both instances are initialized
	// Callback is executed only on success. In case of error it has been already executed
	// in the place where an error occurred
	function instanceLoaded(callback) {
		if(tokenInstance && presaleInstance) {
			logSuccess("Application loaded successfully.\nNetwork " + networkName(myNetwork));
			tryCallbackIfProvided(callback, null, {
				event: "init_complete",
				network: networkName(myNetwork)
			});
		}
	}
	// ---------- END SECTION 2: Auxiliary private functions ----------


	// ---------- START SECTION 3: API Initialization ----------
	/**
	 * Initializes presale API.
	 * 	* Checks if Web3 is enabled (MetaMask installed) – synchronous
	 * 	* Checks if user account is accessible (MetaMask unlocked)
	 * 	* Checks user balance (if its possible to submit transaction)
	 * 	* Loads ERC721 token smart contract ABI
	 * 	* Connects to deployed ERC721 instance and checks its version
	 * 	* Loads Presale smart contract ABI
	 * 	* Connects to deployed Presale instance and checks its version
	 * After all checks are done, sets tokenInstance and presaleInstance.
	 * If something goes wrong with ERC721 instance initialization,
	 * tokenInstance remains null
	 * If something goes wrong with Presale smart contract initialization,
	 * presaleInstance remains null
	 * @param token an object, representing deployed token instance, contains address, ABI URL or ABI itself
	 * 	{address: "0xabc...", abi_url: "https://path.to/abi.json", abi: [...abi array...]}
	 * 	if a string is passed instead of object – it will be treated as an address, equal to {address: token}
	 * @param presale an object, representing deployed presale instance, contains address, ABI URL or ABI itself
	 * 	{address: "0xabc...", abi_url: "https://path.to/abi.json", abi: [...abi array...]}
	 * 	if a string is passed instead of object – it will be treated as an address, equal to {address: presale}
	 * @param callback a function to be executed once initialization is complete,
	 * callback signature: callback(error, result) – error is null on success
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.init = function(token, presale, callback) {
		if(typeof window.web3 == 'undefined') {
			logError("Web3 is not enabled. Do you need to install MetaMask?");
			return ERR_NO_WEB3;
		}
		myWeb3 = new Web3(window.web3.currentProvider);
		myWeb3.eth.getAccounts(function(err, accounts) {
			if(err) {
				logError("getAccounts() error: ", err);
				tryCallbackIfProvided(callback, ERR_WEB3_ETH_ERROR, err);
				return;
			}
			myAccount = accounts[0];
			myNetwork = myWeb3.version.network;
			if(!myAccount) {
				const err = "Cannot access default account.\nIs MetaMask locked?";
				logError(err);
				tryCallbackIfProvided(callback, ERR_WEB3_LOCKED, err);
				return;
			}
			logInfo("Web3 integration loaded. Your account is ", myAccount, ", network id ", networkName(myNetwork));
			myWeb3.eth.getBalance(myAccount, function(err, balance) {
				if(err) {
					logError("getBalance() error: ", err);
					tryCallbackIfProvided(callback, ERR_WEB3_ETH_ERROR, err);
					return;
				}
				if(balance > 210000000000000) { // 0.21 finney
					logInfo("Your balance is ", myWeb3.fromWei(balance, 'ether'), " ETH");
				}
				else if(balance > 0) {
					logWarning("Your ETH balance is close to zero.\nYou won't be able to send most transactions.");
				}
				else {
					logError("Your ETH balance is zero.\nYou won't be able to send any transaction.");
				}

				// if token contains ABI – do not make AJAX call, just load the contract
				if(token.abi) {
					loadTokenContract(token.abi);
				}
				// if token doesn't contain ABI – load it through AJAX call and then load the contract
				else {
					jQuery3.ajax({
						global: false,
						url: token.abi_url || "abi/ERC721.json",
						dataType: "json",
						success: function(data, textStatus, jqXHR) {
							logInfo("ERC721 ABI loaded successfully");
							loadTokenContract(data.abi);
						},
						error: function(jqXHR, textStatus, errorThrown) {
							logError("Cannot load ERC721 ABI: ", errorThrown);
							tryCallbackIfProvided(callback, ERR_AJAX_LOAD_ABI, errorThrown);
						}
					});
				}

				// if presale contains ABI – do not make AJAX call, just load the contract
				if(presale.abi) {
					loadPresaleContract(presale.abi);
				}
				// if presale doesn't contain ABI – load it through AJAX call and then load the contract
				else {
					jQuery3.ajax({
						global: false,
						url: presale.abi_url || "abi/Presale.json",
						dataType: "json",
						success: function(data, textStatus, jqXHR) {
							logInfo("Presale ABI loaded successfully");
							loadPresaleContract(data.abi);
						},
						error: function(jqXHR, textStatus, errorThrown) {
							logError("Cannot load Presale ABI: ", errorThrown);
							tryCallbackIfProvided(callback, ERR_AJAX_LOAD_ABI, errorThrown);
						}
					});
				}

				// --- START: Internal Section to Load Contracts ---
				// helper function to load token contract by ABI
				function loadTokenContract(abi) {
					const contract = myWeb3.eth.contract(abi);
					const address = token.address || token;
					const instance = contract.at(address);
					if(!instance.TOKEN_VERSION) {
						const err = "Wrong ERC721 ABI format: TOKEN_VERSION is undefined";
						logError(err);
						tryCallbackIfProvided(callback, ERR_WRONG_ABI, err);
						return;
					}
					instance.TOKEN_VERSION(function(err, version) {
						if(err) {
							logError("Error accessing ERC721 instance: ", err, "\nCannot access TOKEN_VERSION.");
							tryCallbackIfProvided(callback, ERR_WEB3_ERROR, err);
							return;
						}
						if(TOKEN_VERSION != version) {
							const err = "Error accessing ERC721 instance: not a valid instance.\n" +
								"Check if the address specified points to an ERC721 instance with a valid TOKEN_VERSION.\n" +
								"Version required: " + TOKEN_VERSION + ". Version found: " + version;
							logError(err);
							tryCallbackIfProvided(callback, ERR_CONTRACT_VERSION_MISMATCH, err);
							return;
						}
					logInfo("Successfully connected to ERC721 instance at ", address);
						tokenInstance = instance;
						instanceLoaded(callback);
						tokenInstance.balanceOf(myAccount, function(err, result) {
							if(err) {
								logError("Unable to get ERC721 token balance for account ", myAccount, ": ", err);
								return;
							}
							if(result > 0) {
								logInfo("You own ", result, " ERC721 tokens");
							}
							else {
								logInfo("You don't own any ERC721 tokens");
							}
						});
					});
				}

				// helper function to load presale contract by ABI
				function loadPresaleContract(abi) {
					const contract = myWeb3.eth.contract(abi);
					const address = presale.address || presale;
					const instance = contract.at(address);
					if(!instance.PRESALE_VERSION) {
						const err = "Wrong Presale ABI format: PRESALE_VERSION is undefined";
						logError(err);
						tryCallbackIfProvided(callback, ERR_WRONG_ABI, err);
						return;
					}
					instance.PRESALE_VERSION(function(err, version) {
						if(err) {
							logError("Error accessing Presale instance: ", err, "\nCannot access PRESALE_VERSION.");
							tryCallbackIfProvided(callback, ERR_WEB3_ERROR, err);
							return;
						}
						if(PRESALE_VERSION != version) {
							const err = "Error accessing Presale instance: not a valid instance.\n" +
								"Check if the address specified points to a Presale instance with a valid PRESALE_VERSION.\n" +
								"Version required: " + PRESALE_VERSION + ". Version found: " + version;
							logError(err);
							tryCallbackIfProvided(callback, ERR_CONTRACT_VERSION_MISMATCH, err);
							return;
						}
						logInfo("Successfully connected to Presale instance at ", address);
						presaleInstance = instance;
						instanceLoaded(callback);
					});
				}
				// --- END: Internal Section to Load Contracts ---

			});
		});

		return 0;
	};

	// getters available right after successful initialization:
	// Web3 instance, returns null if not initialized (probably MetaMask is not installed)
	this.getWeb3 = function() {
		return myWeb3;
	};
	// current active account, returns null if not initialized or account is inaccessible (probably MetaMask is locked)
	this.getDefaultAccount = function() {
		return myAccount;
	};
	// currently connected network ID, returns null if not initialized
	this.getNetworkId = function() {
		return myNetwork;
	};
	// user-friendly name for network ID
	this.getNetworkName = function() {
		return networkName(myNetwork);
	};
	// checks if instance is successfully initialized
	this.initialized = function() {
		return tokenInstance && presaleInstance;
	};
	// ---------- END SECTION 3: API Initialization ----------


	// ---------- START SECTION 4: Presale API Transactions ----------
	/**
	 * Prepares a Web3 transaction to buy geodes.
	 * Requires an API to be properly initialized:
	 * tokenInstance and presaleInstance initialized
	 * @param n number of geodes to buy
	 * @param callback a function to call on error / success
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.buyGeodes = function(n, callback) {
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		presaleInstance.currentPrice(function(err, result) {
			if(err) {
				logError("Unable to get current geode price: ", err);
				tryCallbackIfProvided(callback, err, null);
				return;
			}
			logInfo("current geode price ", myWeb3.fromWei(result, 'ether'), " ETH");
			presaleInstance.getGeodes.sendTransaction({value: result.times(n)}, function(err, txHash) {
				if(err) {
					logError("getGeodes() transaction wasn't sent: ", err.toString().split("\n")[0]);
					tryCallbackIfProvided(callback, err, null);
					return;
				}
				logInfo("getGeodes() transaction sent: ", txHash);
				tryCallbackIfProvided(callback, null, {
					event: "transaction_sent",
					name: "getGeodes",
					txHash: txHash
				});

				// TODO: wait for this particular event to return and call callback
			});
		});
		// no sync errors – return 0
		return 0;
	};

	/**
	 * Adds a promotion coupon which allows to get free gems
	 * @param code coupon code (string)
	 * @param freeGems number of gems this coupon allows to get
	 * @param callback a function to call on error / success
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.addCoupon = function(code, freeGems, callback) {
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		if(!code || !code.trim || code.trim().length === 0) {
			logError("coupon code is not set or empty");
			return ERR_WRONG_INPUT;
		}
		if(!freeGems || isNaN(freeGems) || freeGems <= 0) {
			logError("free gems value is not set, is empty, is zero, or negative");
			return ERR_WRONG_INPUT;
		}
		const key = myWeb3.sha3(code);
		if(!presaleInstance.addCoupon) {
			logError("Wrong presale ABI: addCoupon is undefined");
			return ERR_WRONG_ABI;
		}
		logInfo("adding coupon ", code, ", ", key, ", ", freeGems);
		presaleInstance.addCoupon(key, freeGems, function(err, result) {
			if(err) {
				logError("addCoupon() transaction wasn't sent: ", err.toString().split("\n")[0]);
				tryCallbackIfProvided(callback, err, null);
				return;
			}
			logInfo("addCoupon() transaction sent: ", result);
			tryCallbackIfProvided(callback, null, {
				event: "transaction_sent",
				name: "addCoupon",
				txHash: result
			});

			// TODO: wait for this particular event to return and call callback
		});
	};

	this.useCoupon = function(code, callback) {
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		if(!code || !code.trim || code.trim().length === 0) {
			logError("coupon code is not set or empty");
			return ERR_WRONG_INPUT;
		}
		if(!presaleInstance.useCoupon) {
			logError("Wrong presale ABI: useCoupon is undefined");
			return ERR_WRONG_ABI;
		}
		if(!presaleInstance.isCouponValid) {
			logError("Wrong presale ABI: isCouponValid is undefined");
			return ERR_WRONG_ABI;
		}
		presaleInstance.isCouponValid(code, function(err, result) {
			if(err) {
				logError("cannot check coupon validity: ", err);
				tryCallback(callback, err, null);
				return;
			}
			logInfo("coupon ", code, " is ", result? "": "in", "valid");
			if(!result) {
				logError("invalid coupon: ", code);
				tryCallback(callback, "invalid coupon " + code, null);
				return;
			}
			logInfo("using coupon ", code);
			presaleInstance.useCoupon(code, function(err, result) {
				if(err) {
					logError("useCoupon() transaction wasn't sent: ", err.toString().split("\n")[0]);
					tryCallbackIfProvided(callback, err, null);
					return;
				}
				logInfo("useCoupon() transaction sent: ", result);
				tryCallbackIfProvided(callback, null, {
					event: "transaction_sent",
					name: "useCoupon",
					txHash: result
				});

				// TODO: wait for this particular event to return and call callback
			});
		});
	};
	// ---------- END SECTION 4: Presale API Transactions ----------


	// ---------- START SECTION 5: Presale API Public Getters ----------
	/**
	 * Gets the presale state to be used in the web page to fill in:
	 * 	* geodes sold
	 * 	* geodes left
	 * 	* current geode price
	 * @param callback a function to call on error / success
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.presaleState = function(callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			tryCallback(callback, "Presale API is not properly initialized", null);
			return ERR_NOT_INITIALIZED;
		}
		presaleInstance.getPacked(function(err, result) {
			if(err) {
				logError("Error getting presale state: " + err);
				tryCallback(callback, err, null);
				return;
			}
			try {
				const uint64 = myWeb3.toBigNumber("0x10000000000000000");
				const sold = result.dividedToIntegerBy(uint64).dividedToIntegerBy(0x10000);
				const left = result.dividedToIntegerBy(uint64).modulo(0x10000);
				const price = result.modulo(uint64);
				logInfo("sold: ", sold, " left: ", left, ", current price: ", price);
				tryCallback(callback, null, {
					sold: sold.toNumber(),
					left: left.toNumber(),
					currentPrice: myWeb3.fromWei(price, "ether").toNumber(),
				});
			}
			catch(e) {
				logError("Error parsing presale state: ", e);
				tryCallback(callback, e, null);
			}
		});
		// no sync errors – return 0
		return 0;
	};

	/**
	 * Checks if coupon is valid – exists in the system and is not expired yet
	 * @param code coupon code to check
	 * @param callback a function to call on error / success
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.isCouponValid = function(code, callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			tryCallback(callback, "Presale API is not properly initialized", null);
			return ERR_NOT_INITIALIZED;
		}
		if(!presaleInstance.isCouponValid) {
			logError("Wrong presale ABI: isCouponValid is undefined");
			return ERR_WRONG_ABI;
		}
		presaleInstance.isCouponValid(code, function(err, result) {
			if(err) {
				logError("cannot check coupon validity: ", err);
				tryCallback(callback, err, null);
				return;
			}
			logInfo("coupon ", code, " is ", result? "": "in", "valid");
			tryCallback(callback, null, result);
		});
		// no sync errors – return 0
		return 0;
	};

	/**
	 * Retrieves amount of geodes owned by a particular address
	 * @param callback a function to pass a result (if successful) or an error
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.getGeodeBalance = function(callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		const owner = myAccount;
		presaleInstance.geodeBalances(owner, function(err, result) {
			if(err) {
				logError("Cannot get geode balance: ", err);
				tryCallback(callback, err, null);
				return;
			}
			logInfo("Address ", owner, " has ", result, " geodes");
			tryCallback(callback, null, result.toNumber());
		});
		// no sync errors – return 0
		return 0;
	};

	/**
	 * Retrieves list of tokens (full objects) owned by a particular address
	 * @param callback a function to pass a result (if successful) or an error
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.getCollection = function(callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && tokenInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		const owner = myAccount;
		tokenInstance.getPackedCollection(owner, function(err, collection) {
			if(err) {
				logError("Cannot load list of the tokens: ", err);
				tryCallback(callback, err, null);
				return;
			}
			if(collection.length > 0) {
				logInfo("Tokens owned by ", owner, ": ", ...collection);
			}
			else {
				logInfo("Address ", owner, " doesn't own any tokens");
			}
			for(let i = 0; i < collection.length; i++) {
				const id = collection[i].dividedToIntegerBy(0x1000000000000);
				const colorId = collection[i].dividedToIntegerBy(0x10000000000).modulo(0x100);
				const levelId = collection[i].dividedToIntegerBy(0x100000000).modulo(0x100);
				const gradeType = collection[i].dividedToIntegerBy(0x1000000).modulo(0x100);
				const gradeValue = collection[i].modulo(0x1000000);
				collection[i] = {
					id: id.toNumber(),
					colorId: colorId.toNumber(),
					levelId: levelId.toNumber(),
					gradeType: gradeType.toNumber(),
					gradeValue: gradeValue.toNumber()
				};
			}
			tryCallback(callback, null, collection);
		});
		// no sync errors – return 0
		return 0;
	};

	/**
	 * Retrieves token creation time in seconds (unix timestamp)
	 * @param tokenId
	 * @param callback a function to pass a result (if successful) or an error
	 * @return {number} positive error code, if error occurred synchronously, zero otherwise
	 * if error occurred asynchronously - error code will be passed to callback
	 */
	this.getTokenCreationTime = function(tokenId, callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && tokenInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}

		tokenInstance.getCreationTime(tokenId, function(err, result) {
			if(err) {
				logError("Cannot get token creation block: ", err);
				tryCallback(callback, err, null);
				return;
			}
			myWeb3.eth.getBlock(result, function(err, result) {
				if(err) {
					logError("Cannot get token creation block: ", err);
					tryCallback(callback, err, null);
					return;
				}
				logInfo("Token ", tokenId, " creation time is ", result.timestamp);
				tryCallback(callback, null, result.timestamp);
			});
		});

		// no sync errors – return 0
		return 0;
	};
	// ---------- END SECTION 5: Presale API Public Getters ----------


	// ---------- START SECTION 6: Public Event Listeners ----------
	// register CouponAdded event listener
	this.registerCouponAddedEventListener = function(callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		const couponAddedEvent = presaleInstance.CouponAdded({_by: myAccount});
		couponAddedEvent.watch(function(err, receipt) {
			if(err) {
				logError("Error receiving CouponAdded event: ", err);
				return;
			}
			if(!(receipt && receipt.args && receipt.args._by && receipt.args.key && receipt.args.expires && receipt.args.freeGems)) {
				logError("CouponAdded event received in wrong format: wrong arguments - ", receipt);
				return;
			}
			const key = receipt.args.key.toString(16);
			const expires = receipt.args.expires;
			const gems = receipt.args.freeGems;
			logInfo("CouponAdded(", key, ", ", expires, ", ", gems, ")");
			tryCallback(callback, null, {
				event: "coupon_added",
				key: key,
				expires: expires.toNumber(),
				freeGems: gems.toNumber(),
				txHash: receipt.transactionHash
			});
		});
		logInfo("Successfully registered CouponAdded(uint256, uint32, uint8) event listener");
		// no sync errors – return 0
		return 0;
	};

	// register CouponConsumed event listener
	this.registerCouponConsumedEventListener = function(callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		const couponConsumedEvent = presaleInstance.CouponConsumed({_to: myAccount});
		couponConsumedEvent.watch(function(err, receipt) {
			if(err) {
				logError("Error receiving CouponConsumed event: ", err);
				return;
			}
			if(!(receipt && receipt.args && receipt.args._from && receipt.args._to && receipt.args.key && receipt.args.gems)) {
				logError("CouponConsumed event received in wrong format: wrong arguments - ", receipt);
				return;
			}
			const from = receipt.args._from;
			const to = receipt.args._to;
			const key = receipt.args.key.toString(16);
			const gems = receipt.args.gems;
			logInfo("CouponConsumed(", from, ", ", to, ", ", key, ", ", gems, ")");
			tryCallback(callback, null, {
				event: "coupon_consumed",
				gems: gems.toNumber(),
				txHash: receipt.transactionHash
			});
		});
		logInfo("Successfully registered CouponConsumed(address, address, uint256, uint8) event listener");
		// no sync errors – return 0
		return 0;
	};

	// register PurchaseComplete event listener
	this.registerPurchaseCompleteEventListener = function(callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		const purchaseCompleteEvent = presaleInstance.PurchaseComplete({_to: myAccount});
		purchaseCompleteEvent.watch(function(err, receipt) {
			if(err) {
				logError("Error receiving PurchaseComplete event: ", err);
				return;
			}
			if(!(receipt && receipt.args
					&& receipt.args._from
					&& receipt.args._to
					&& receipt.args.geodes
					&& receipt.args.gems
					&& receipt.args.price
					&& receipt.args.geodesTotal
					&& receipt.args.gemsTotal)) {
				logError("PurchaseComplete event received in wrong format: wrong arguments - ", receipt);
				return;
			}
			const from = receipt.args._from;
			const to = receipt.args._to;
			const geodes = receipt.args.geodes;
			const gems = receipt.args.gems;
			const price = receipt.args.price;
			const geodesTotal = receipt.args.geodesTotal;
			const gemsTotal = receipt.args.gemsTotal;
			logInfo("PurchaseComplete(", from, ", ", to, ", ", geodes, ", ", gems, ", ", price, ", ", geodesTotal, ", ", gemsTotal, ")");
			tryCallback(callback, null, {
				event: "purchase_complete",
				geodes: geodes.toNumber(),
				gems: gems.toNumber(),
				price: price.toNumber(),
				geodesTotal: geodesTotal.toNumber(),
				gemsTotal: gemsTotal.toNumber(),
				txHash: receipt.transactionHash
			});
		});
		logInfo("Successfully registered PurchaseComplete(address, address, uint16, uint16, uint64) event listener");
		// no sync errors – return 0
		return 0;
	};

	// register PresaleStateChanged event listener
	this.registerPresaleStateChangedEventListener = function(callback) {
		if(!callback || {}.toString.call(callback) !== '[object Function]') {
			logError("callback is undefined or is not a function");
			return ERR_NO_CALLBACK;
		}
		if(!(myWeb3 && myAccount && presaleInstance)) {
			logError("Presale API is not properly initialized. Reload the page.");
			return ERR_NOT_INITIALIZED;
		}
		const presaleStateChangedEvent = presaleInstance.PresaleStateChanged();
		presaleStateChangedEvent.watch(function(err, receipt) {
			if(err) {
				logError("Error receiving PresaleStateChanged event: ", err);
				return;
			}
			if(!(receipt && receipt.args
					&& receipt.args.sold
					&& receipt.args.left
					&& receipt.args.lastPrice
					&& receipt.args.currentPrice)) {
				logError("PresaleStateChanged event received in wrong format: wrong arguments - ", receipt);
				return;
			}
			const sold = receipt.args.sold;
			const left = receipt.args.left;
			const lastPrice = receipt.args.lastPrice;
			const currentPrice = receipt.args.currentPrice;
			logInfo("PresaleStateChanged(", sold, ", ", left, ", ", lastPrice, ", ", currentPrice, ")");
			tryCallback(callback, null, {
				event: "presale_state_changed",
				sold: sold.toNumber(),
				left: left.toNumber(),
				lastPrice: myWeb3.fromWei(lastPrice, "ether").toNumber(),
				currentPrice: myWeb3.fromWei(currentPrice, "ether").toNumber(),
				txHash: receipt.transactionHash
			});
		});
		logInfo("Successfully registered PresaleStateChanged(uint16, uint16, uint64, uint64, uint64) event listener");
		// no sync errors – return 0
		return 0;
	};
	// ---------- END SECTION 6: Public Event Listeners ----------

}
