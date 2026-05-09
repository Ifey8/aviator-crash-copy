// SPDX-License-Identifier: MIT
// MockUSDT — minimal TRC20 token for Shasta testnet only.
// Mirrors the Tether USDT interface (transfer / balanceOf / approve / transferFrom)
// without the production-only features (mint, burn, pause, blacklist, fee).
//
// DEPLOY (TronIDE @ https://www.tronide.io/):
//   compiler: 0.5.10 (or 0.5.x)
//   environment: Injected Web3  (TronLink, switched to Shasta)
//   constructor params:
//     _name           = "Test USDT"
//     _symbol         = "USDT"
//     _decimals       = 6
//     _initialSupply  = 1000000000000        (= 1,000,000 USDT * 10^6)
//
// Deployer wallet receives the entire initialSupply. Use `transfer()`
// to top up your test buyer wallet.
pragma solidity ^0.5.10;

contract MockUSDT {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _initialSupply
    ) public {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        totalSupply = _initialSupply;
        balanceOf[msg.sender] = _initialSupply;
        emit Transfer(address(0), msg.sender, _initialSupply);
    }

    function transfer(address to, uint256 value) public returns (bool) {
        require(to != address(0), "to=0");
        require(balanceOf[msg.sender] >= value, "balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(to != address(0), "to=0");
        require(balanceOf[from] >= value, "balance");
        require(allowance[from][msg.sender] >= value, "allowance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        allowance[from][msg.sender] -= value;
        emit Transfer(from, to, value);
        return true;
    }
}
