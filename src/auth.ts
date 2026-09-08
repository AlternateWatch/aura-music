import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_code';

// 1. Hash a password before saving to DB
export const hashPassword = async (password: string) => {
    return await bcrypt.hash(password, 10);
};

// 2. Compare entered password with DB password
export const comparePassword = async (password: string, hash: string) => {
    return await bcrypt.compare(password, hash);
};

// 3. Generate a Token for the user
export const generateToken = (userId: number) => {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
};