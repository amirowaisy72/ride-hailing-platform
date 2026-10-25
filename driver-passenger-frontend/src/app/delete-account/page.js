
export default function DeleteAccountPage() {
    const email = "masteramir122@gmail.com";

    const subject = encodeURIComponent("Safar Account Deletion Request");
    const body = encodeURIComponent(
        "Hello Safar Support,\n\n" +
        "I want to permanently delete my Safar account.\n\n" +
        "Registered Email: \n" +
        "Registered Phone Number: \n\n" +
        "Please verify my identity and process my account deletion request.\n\n" +
        "Thank you."
    );

    return (
        <main className="min-h-screen bg-white px-5 py-12 text-gray-900">
            <div className="mx-auto max-w-xl">
                <h1 className="mb-5 text-3xl font-bold">
                    Safar - Delete Account
                </h1>

                <p className="mb-5">
                    Safar allows passengers and drivers to request
                    permanent deletion of their accounts and
                    associated personal data.
                </p>

                <h2 className="mb-3 text-xl font-bold">
                    How to Request Account Deletion
                </h2>

                <ol className="mb-6 list-decimal space-y-2 pl-6">
                    <li>Click the Request Account Deletion button.</li>
                    <li>Enter your registered email or phone number.</li>
                    <li>Send the email to Safar Support.</li>
                    <li>Our support team will verify your identity.</li>
                    <li>After verification, your deletion request will be processed.</li>
                </ol>

                <h2 className="mb-3 text-xl font-bold">
                    Data Deletion
                </h2>

                <p className="mb-5">
                    Once your request is verified, Safar will delete
                    your account and associated personal data,
                    including profile information and saved locations,
                    except information that must be retained for
                    legal, security, or regulatory purposes.
                </p>

                <p className="mb-6">
                    Some transaction or trip records may be retained
                    where legally required.
                </p>

                <a
                    href={`mailto:${email}?subject=${subject}&body=${body}`}
                    className="inline-block rounded-xl bg-green-600 px-6 py-4 font-semibold text-white"
                >
                    Request Account Deletion
                </a>

                <p className="mt-6 text-sm text-gray-600">
                    Support Email: {email}
                </p>
            </div>
        </main>
    );
}
