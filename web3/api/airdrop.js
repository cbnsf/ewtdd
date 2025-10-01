import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

export default async function handler(req, res) {
  // 只允许POST请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress } = req.body;

    // 验证输入
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // 验证钱包地址格式
    let recipientPublicKey;
    try {
      recipientPublicKey = new PublicKey(walletAddress);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // 从环境变量获取配置
    const senderPrivateKey = process.env.SENDER_PRIVATE_KEY;
    const tokenMintAddress = process.env.TOKEN_MINT_ADDRESS;
    const rpcUrl = process.env.RPC_URL;
    const tokenAmount = parseInt(process.env.TOKEN_AMOUNT || '25000');

    // 检查环境变量
    if (!senderPrivateKey || !tokenMintAddress || !rpcUrl) {
      console.error('Missing environment variables');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // 解析发送者私钥
    let senderKeypair;
    try {
      // 支持两种格式：Base58字符串或JSON数组
      let privateKeyArray;
      if (senderPrivateKey.startsWith('[')) {
        // JSON数组格式
        privateKeyArray = JSON.parse(senderPrivateKey);
      } else {
        // Base58格式
        const bs58 = await import('bs58');
        privateKeyArray = Array.from(bs58.default.decode(senderPrivateKey));
      }
      senderKeypair = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
    } catch (error) {
      console.error('Error parsing private key:', error);
      return res.status(500).json({ error: 'Invalid sender private key format' });
    }

    // 创建连接
    const connection = new Connection(rpcUrl, 'confirmed');

    // 创建代币mint的公钥
    const mintPublicKey = new PublicKey(tokenMintAddress);

    // 获取发送者的代币账户地址
    const senderTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      senderKeypair.publicKey
    );

    // 获取接收者的代币账户地址
    const recipientTokenAccount = await getAssociatedTokenAddress(
      mintPublicKey,
      recipientPublicKey
    );

    // 检查发送者余额
    const senderBalance = await connection.getTokenAccountBalance(senderTokenAccount);
    if (senderBalance.value.uiAmount < tokenAmount) {
      return res.status(400).json({ error: 'insufficient_token_balance' });
    }

    // 检查接收者是否已经有代币账户，如果没有需要创建
    let recipientTokenAccountInfo;
    try {
      recipientTokenAccountInfo = await connection.getAccountInfo(recipientTokenAccount);
    } catch (error) {
      console.error('Error checking recipient token account:', error);
    }

    const transaction = new Transaction();

    // 如果接收者没有代币账户，需要先创建
    if (!recipientTokenAccountInfo) {
      const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
      const createATAInstruction = createAssociatedTokenAccountInstruction(
        senderKeypair.publicKey, // 支付账户
        recipientTokenAccount,   // 关联代币账户地址
        recipientPublicKey,      // 代币所有者
        mintPublicKey           // 代币mint地址
      );
      transaction.add(createATAInstruction);
    }

    // 添加转账指令
    const transferInstruction = createTransferInstruction(
      senderTokenAccount,        // 发送者代币账户
      recipientTokenAccount,     // 接收者代币账户
      senderKeypair.publicKey,   // 发送者地址
      tokenAmount * Math.pow(10, 9) // 假设代币有6位小数，调整这个值以匹配你的代币小数位数
    );
    transaction.add(transferInstruction);

    // 设置最新的区块哈希
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = senderKeypair.publicKey;

    // 发送交易
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [senderKeypair],
      { commitment: 'confirmed' }
    );

    console.log(`Airdrop successful: ${signature}`);
    
    return res.status(200).json({
      success: true,
      signature: signature,
      amount: tokenAmount,
      message: `Successfully airdropped ${tokenAmount} DUCK tokens`
    });

  } catch (error) {
    console.error('Airdrop error:', error);

    // 处理特定错误
    if (error.message.includes('already in use')) {
      return res.status(400).json({ error: 'already_claimed_or_has_balance' });
    }

    return res.status(500).json({ 
      error: error.message || 'Internal server error during airdrop' 
    });
  }
}