const crypto = require('crypto');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Cryptographic utilities for tamper-proof verification
 * Implements SHA-256 hashing and RSA digital signatures
 */

class CryptoUtils {
  constructor() {
    this.privateKey = null;
    this.publicKey = null;
    this.loadKeys();
  }

  /**
   * Load RSA key pair from files or generate new ones
   */
  loadKeys() {
    try {
      const privateKeyPath = process.env.PRIVATE_KEY_PATH || path.join(__dirname, '../keys/private.pem');
      const publicKeyPath = process.env.PUBLIC_KEY_PATH || path.join(__dirname, '../keys/public.pem');

      // Ensure keys directory exists
      const keysDir = path.dirname(privateKeyPath);
      if (!fs.existsSync(keysDir)) {
        fs.mkdirSync(keysDir, { recursive: true });
      }

      // Try to load existing keys
      if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
        this.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
        logger.info('RSA key pair loaded successfully');
      } else {
        // Generate new key pair
        logger.info('Generating new RSA key pair...');
        this.generateKeyPair();
        
        // Save keys to files
        fs.writeFileSync(privateKeyPath, this.privateKey);
        fs.writeFileSync(publicKeyPath, this.publicKey);
        logger.info('New RSA key pair generated and saved');
      }
    } catch (error) {
      logger.error('Error loading/generating keys:', error);
      throw new Error('Failed to initialize cryptographic keys');
    }
  }

  /**
   * Generate a new RSA key pair
   */
  generateKeyPair() {
    const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    this.privateKey = forge.pki.privateKeyToPem(keyPair.privateKey);
    this.publicKey = forge.pki.publicKeyToPem(keyPair.publicKey);
  }

  /**
   * Create canonical JSON representation of a record
   * Ensures consistent ordering for hash generation
   */
  createCanonicalJson(record) {
    // Remove fields that shouldn't be included in hash calculation
    const excludeFields = ['record_hash', 'created_at', 'updated_at', 'verification_status', 'canonical_json'];
    
    const cleanRecord = {};
    Object.keys(record)
      .filter(key => !excludeFields.includes(key))
      .sort() // Ensure consistent key ordering
      .forEach(key => {
        if (record[key] !== null && record[key] !== undefined) {
          cleanRecord[key] = record[key];
        }
      });

    return JSON.stringify(cleanRecord, null, 0); // No whitespace for consistency
  }

  /**
   * Generate SHA-256 hash of a record
   */
  generateHash(record) {
    const canonicalJson = this.createCanonicalJson(record);
    return crypto.createHash('sha256').update(canonicalJson).digest('hex');
  }

  /**
   * Create digital signature for a record
   */
  signRecord(record, signerInfo = {}) {
    try {
      const canonicalJson = this.createCanonicalJson(record);
      const hash = crypto.createHash('sha256').update(canonicalJson).digest();
      
      // Create signature using private key
      const privateKeyObj = forge.pki.privateKeyFromPem(this.privateKey);
      const signature = privateKeyObj.sign(hash);
      const signatureBase64 = forge.util.encode64(signature);

      return {
        signature: signatureBase64,
        publicKey: this.publicKey,
        signerInfo: {
          name: signerInfo.name || 'System',
          role: signerInfo.role || 'Automated',
          email: signerInfo.email || 'system@transparency.gov',
          timestamp: new Date().toISOString(),
        },
        algorithm: 'RSA-SHA256',
      };
    } catch (error) {
      logger.error('Error signing record:', error);
      throw new Error('Failed to create digital signature');
    }
  }

  /**
   * Verify digital signature of a record
   */
  verifySignature(record, signature, publicKey = null) {
    try {
      const canonicalJson = this.createCanonicalJson(record);
      const hash = crypto.createHash('sha256').update(canonicalJson).digest();
      
      // Use provided public key or default
      const keyToUse = publicKey || this.publicKey;
      const publicKeyObj = forge.pki.publicKeyFromPem(keyToUse);
      
      // Decode signature from base64
      const signatureBytes = forge.util.decode64(signature);
      
      // Verify signature
      const isValid = publicKeyObj.verify(hash, signatureBytes);
      
      return {
        isValid,
        algorithm: 'RSA-SHA256',
        verifiedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error verifying signature:', error);
      return {
        isValid: false,
        error: error.message,
        verifiedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Verify record integrity by comparing stored hash with computed hash
   */
  verifyRecordIntegrity(record, storedHash) {
    const computedHash = this.generateHash(record);
    return {
      isValid: computedHash === storedHash,
      storedHash,
      computedHash,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Complete verification of a record (hash + signature)
   */
  async completeVerification(record, storedHash, signatures = []) {
    const hashVerification = this.verifyRecordIntegrity(record, storedHash);
    
    const signatureVerifications = signatures.map(sig => {
      return {
        ...this.verifySignature(record, sig.signature, sig.public_key),
        signer: {
          name: sig.approver_name,
          role: sig.approver_role,
          email: sig.approver_email,
          signedAt: sig.signed_at,
        },
      };
    });

    const allSignaturesValid = signatureVerifications.length > 0 && 
                              signatureVerifications.every(sig => sig.isValid);

    let verificationStatus = 'suspicious';
    if (hashVerification.isValid && allSignaturesValid) {
      verificationStatus = 'verified';
    } else if (hashVerification.isValid && signatureVerifications.length === 0) {
      verificationStatus = 'pending';
    }

    return {
      recordId: record.id,
      verificationStatus,
      hashVerification,
      signatureVerifications,
      overallValid: hashVerification.isValid && (allSignaturesValid || signatureVerifications.length === 0),
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate verification QR code data
   */
  generateVerificationQR(recordId, recordType) {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verificationUrl = `${baseUrl}/verify/${recordType}/${recordId}`;
    
    return {
      url: verificationUrl,
      data: {
        recordId,
        recordType,
        verificationUrl,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Hash a document/file for integrity verification
   */
  hashDocument(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

// Create singleton instance
const cryptoUtils = new CryptoUtils();

module.exports = cryptoUtils;
