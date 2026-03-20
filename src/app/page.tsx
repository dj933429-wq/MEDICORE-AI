import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-6xl font-bold text-gray-800 mb-4">MediCore AI</h1>
        <p className="text-xl text-gray-600 mb-8">Your AI-Powered Hospital Management System</p>
        <div className="flex justify-center space-x-4">
          <Link href="/login" className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            Login
          </Link>
          <Link href="/signup" className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors">
            Sign Up
          </Link>
        </div>
      </div>
    </div>
  );
}