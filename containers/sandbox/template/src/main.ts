/**
 * Template main file.
 * This is the default entry point for sandbox workspace.
 */

console.log('Hello from sandbox workspace!');
console.log('Node version:', process.version);
console.log('Working directory:', process.cwd());

// Example function
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

// Run if executed directly
const message = greet('World');
console.log(message);
