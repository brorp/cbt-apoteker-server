import { db } from "../config/db.js";
import { users } from "./schema.js";

async function seed() {
    console.log("Seeding demo accounts...");

    try {
        // Super Admin
        await db.insert(users).values({
            name: "Super Admin",
            email: "admin@cbt.com",
            password: "adminpassword", // Plaintext as no hashing lib is present in package.json
            role: "admin",
            education: "Apoteker",
            schoolOrigin: "Institut Teknologi Bandung",
            examPurpose: "ukai",
            address: "Jl. Ganesha No. 10, Bandung",
            phone: "+6281122334455",
            isPremium: true,
        }).onConflictDoNothing();

        // 3 Demo Users
        const demoUsers = [
            {
                name: "Budi Santoso",
                email: "budi@example.com",
                password: "userpassword",
                role: "user" as const,
                education: "S1 Farmasi",
                schoolOrigin: "Universitas Indonesia",
                examPurpose: "ukai" as const,
                address: "Depok, Jawa Barat",
                phone: "+6289911223344",
                isPremium: true,
            },
            {
                name: "Siti Aminah",
                email: "siti@example.com",
                password: "userpassword",
                role: "user" as const,
                education: "S1 Farmasi",
                schoolOrigin: "Universitas Gadjah Mada",
                examPurpose: "cpns" as const,
                address: "Sleman, Yogyakarta",
                phone: "+6289955667788",
                isPremium: true,
            },
            {
                name: "Ahmad Hidayat",
                email: "ahmad@example.com",
                password: "userpassword",
                role: "user" as const,
                education: "S1 Farmasi",
                schoolOrigin: "Universitas Airlangga",
                examPurpose: "pppk" as const,
                address: "Surabaya, Jawa Timur",
                phone: "+6289999001122",
                isPremium: false,
            },
        ];

        for (const demoUser of demoUsers) {
            await db.insert(users).values(demoUser).onConflictDoNothing();
        }

        console.log("Seeding completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Seeding failed:", error);
        process.exit(1);
    }
}

seed();
