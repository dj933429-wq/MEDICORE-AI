import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-gray-100">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 tracking-tight mb-4">
          MEDICORE AI
        </h1>
        <p className="text-xl md:text-2xl text-gray-600 mb-10">
          Smart Medical Record System
        </p>
        <Link 
          href="/login" 
          className="inline-block px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"
        >
          Get Started
        </Link>
      </div>
    </div>
  );
}