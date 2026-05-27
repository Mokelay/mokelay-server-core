import { Hash } from '@adonisjs/hash'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'

let hash: Hash | undefined

function usePasswordHash() {
  if (!hash) {
    hash = new Hash(new Scrypt({}))
  }

  return hash
}

export async function hashPassword(password: string) {
  return await usePasswordHash().make(password)
}

export async function verifyPassword(hashedPassword: string, plainPassword: string) {
  return await usePasswordHash().verify(hashedPassword, plainPassword)
}
